const express = require('express');
const router = express.Router();
const connection = require('./db');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
const { chunkPDF, generateEmbedding, answerQuestion } = require('./rag');

router.use(fileUpload());

// your routes here
router.get('/', async function (req, res) {
    const [products] = await connection.execute(`
        SELECT Products.product_id, Products.name, Products.description,
               Products.pdf_id, PDF.filename, PDF.original_filename
        FROM Products
        LEFT JOIN PDF ON Products.pdf_id = PDF.pdf_id
    `);

    res.render('products/index', {
        results: products
    });
});

router.get('/search', async function (req, res) {
    const query = req.query.q;

    if (!query) {
        return res.redirect('/products');
    }

    const queryEmbedding = await generateEmbedding(query);
    const vectorString = '[' + queryEmbedding.join(',') + ']';

    const [results] = await connection.execute(`
        SELECT DISTINCT
            Products.product_id,
            Products.name,
            Products.description,
            Products.pdf_id,
            PDF.filename,
            PDF.original_filename,
            PDFChunks.chunk_text,
            VEC_DISTANCE(PDFChunks.embedding, VEC_FromText(?)) AS distance
        FROM PDFChunks
        JOIN PDF ON PDFChunks.pdf_id = PDF.pdf_id
        JOIN Products ON Products.pdf_id = PDF.pdf_id
        ORDER BY distance ASC
        LIMIT 10
    `, [vectorString]);

    res.render('products/search', {
        query: query,
        results: results
    });
});

router.get('/:productId', async function (req, res) {
    const [products] = await connection.execute(`
        SELECT Products.product_id, Products.name, Products.description,
               Products.pdf_id, PDF.filename, PDF.original_filename
        FROM Products
        LEFT JOIN PDF ON Products.pdf_id = PDF.pdf_id
        WHERE Products.product_id = ?
    `, [req.params.productId]);

    const product = products[0];

    if (!product) {
        return res.status(404).send('Product not found');
    }

    res.render('products/details', {
        product: product
    });
});

router.get('/:productId/upload', async function (req, res) {
    const [products] = await connection.execute(
        'SELECT * FROM Products WHERE product_id = ?',
        [req.params.productId]
    );

    res.render('products/upload', {
        product: products[0]
    });
});

router.post('/:productId/upload', async function (req, res, next) {
    const conn = await connection.getConnection();
    await conn.beginTransaction();

    try {
        // 1. Check if a file was uploaded
        if (!req.files || !req.files.pdf) {
            throw new Error('No file uploaded');
        }

        // 2. Check if the file is a PDF
        const pdfFile = req.files.pdf;
        if (path.extname(pdfFile.name).toLowerCase() !== '.pdf') {
            throw new Error('Only PDF files are allowed');
        }

        // 3. Create an uploads directory if it doesn't exist
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        // 4. Generate a unique filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const filename = uniqueSuffix + path.extname(pdfFile.name);
        const filePath = path.join(uploadDir, filename);

        // 5. Move the file to the uploads directory
        await pdfFile.mv(filePath);

        // 6. Insert the file details into the database
        const productId = req.params.productId;
        const [result] = await conn.execute(
            'INSERT INTO PDF (filename, original_filename, file_path, file_size) VALUES (?, ?, ?, ?)',
            [filename, pdfFile.name, filePath, pdfFile.size]
        );
        const newPdfId = result.insertId;

        // 7. Link the PDF to the product
        await conn.execute(
            'UPDATE Products SET pdf_id = ? WHERE product_id = ?',
            [newPdfId, productId]
        );

        // 8. Chunk the PDF and generate embeddings
        const chunks = await chunkPDF(filePath);

        for (const chunk of chunks) {
            const embeddingValues = await generateEmbedding(chunk.text);
            const vectorString = '[' + embeddingValues.join(',') + ']';

            await conn.execute(
                'INSERT INTO PDFChunks (pdf_id, chunk_text, chunk_order, embedding) VALUES (?, ?, ?, VEC_FromText(?))',
                [newPdfId, chunk.text, chunk.order, vectorString]
            );
        }

        await conn.commit();
        res.redirect('/products/' + productId);
    } catch (e) {
        await conn.rollback();
        next(e);
    } finally {
        conn.release();
    }
});

router.post('/:productId/chat', express.json(), async function (req, res, next) {
    try {
        const productId = req.params.productId;
        const question = req.body.question;

        if (!question) {
            return res.status(400).json({ error: 'Question is required' });
        }

        const [products] = await connection.execute(
            'SELECT pdf_id FROM Products WHERE product_id = ?',
            [productId]
        );

        if (products.length === 0 || !products[0].pdf_id) {
            return res.status(404).json({ error: 'No PDF found for this product' });
        }

        const pdfId = products[0].pdf_id;
        const answer = await answerQuestion(question, pdfId, connection);

        res.json({ answer });
    } catch (e) {
        next(e);
    }
});

module.exports = router;