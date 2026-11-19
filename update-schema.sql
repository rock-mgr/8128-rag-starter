USE crm;

CREATE TABLE IF NOT EXISTS PDF (
    pdf_id INT AUTO_INCREMENT PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size INT,
    upload_date DATETIME DEFAULT NOW(),
    description TEXT
);

ALTER TABLE Products
ADD COLUMN pdf_id INT,
ADD FOREIGN KEY (pdf_id) REFERENCES PDF(pdf_id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS PDFChunks (
    chunk_id INT AUTO_INCREMENT PRIMARY KEY,
    pdf_id INT NOT NULL,
    chunk_text TEXT NOT NULL,
    chunk_order INT NOT NULL,
    embedding VECTOR(768) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pdf_id) REFERENCES PDF(pdf_id) ON DELETE CASCADE,
    INDEX idx_pdf_id (pdf_id),
    VECTOR INDEX (embedding) DISTANCE=cosine
);