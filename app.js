const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

// Create Express app
const app = express();
const port = 3000;

// Set up Multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'images')));  // Serve images

// Function to find the product image file with various extensions
function findProductImage(productImageSlug) {
    const extensions = ['.png', '.jpg', '.jpeg', '.webp'];  // Supported extensions
    for (const ext of extensions) {
        const imagePath = path.join(__dirname, 'images', `${productImageSlug}${ext}`);
        if (fs.existsSync(imagePath)) {
            return imagePath;
        }
    }
    return null;  // Return null if no image is found
}

// POST route to upload the spreadsheet and generate images
app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    // Read the uploaded spreadsheet
    const filePath = path.join(__dirname, 'uploads', req.file.filename);
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Convert the spreadsheet data to JSON
    const data = xlsx.utils.sheet_to_json(sheet);

    // Log the parsed data to inspect what the CSV is returning
    console.log('Parsed Data:', data);

    // Clean up by deleting the uploaded file after reading it
    fs.unlinkSync(filePath);

    // Sanitize the keys by trimming extra spaces from the headers
    const cleanedData = data.map(row => {
        const cleanedRow = {};
        for (let key in row) {
            const cleanedKey = key.trim();  // Trim spaces around the column names
            cleanedRow[cleanedKey] = row[key];
        }
        return cleanedRow;
    });

    // Log the cleaned data to verify that it's sanitized correctly
    console.log('Cleaned Data:', cleanedData);

    // Define an array to hold individual images
    const imageBuffers = [];

    // Load the background image (assumed to be the same for all products)
    const backgroundImagePath = path.join(__dirname, 'images', 'background.png');
    const backgroundImage = fs.existsSync(backgroundImagePath) ? await sharp(backgroundImagePath).toBuffer() : null;

    // Adjusted font size and positioning for the text and price
    const fontSize = 40;
    const productX = 20;   // X coordinate for product name
    const productY = 50;   // Y coordinate for product name
    const descriptionY = 90; // Y coordinate for description
    const priceX = 600;    // X coordinate for price
    const priceY = 100;    // Y coordinate for price
    const oldPriceY = 140; // Y coordinate for old price
    
    // Loop through the cleaned data to generate images
    for (let i = 0; i < cleanedData.length; i++) {
        const item = cleanedData[i];

        // Get all necessary data from the row
        const text = (item['Product'] || 'No Product').trim();
        const price = String(item['Price'] || 'No Price').trim().replace(/\s+/g, '');
        const oldPrice = String(item['Old Price'] || '').trim().replace(/\s+/g, '');
        const discountInfo = (item['Discount Info'] || '').trim();
        const description = (item['Description'] || '').trim();
        const category = (item['Category'] || '').trim();

        // Find the product image by converting the product name to a slug (lowercase, replace spaces)
        const productImageSlug = text.toLowerCase().replace(/\s+/g, '-');

        // Use the function to find the product image in multiple formats
        const productImagePath = findProductImage(productImageSlug);

        // Log the product image slug and path
        console.log(`Looking for image: ${productImageSlug}`);
        console.log(`Image path: ${productImagePath}`);

        if (productImagePath) {
            console.log(`Image found for product: ${text}`);
        } else {
            console.log(`No image found for product: ${text}`);
        }

        // Initialize the compositeImages array here
        let compositeImages = [];

        // Load the background image (if available)
        if (backgroundImage) {
            compositeImages.push({ input: backgroundImage, left: 0, top: 0 });
        }

        // Load product-specific image if it exists
        let productImage = productImagePath ? await sharp(productImagePath).toBuffer() : null;

        // Resize product-specific image if it exists
        if (productImage) {
            productImage = await sharp(productImage)
                .resize({ 
                    width: 150,   // Maximum width for placing next to the text
                    height: 150,  // Maximum height
                    fit: sharp.fit.inside,  // Keep aspect ratio inside these dimensions
                })
                .toBuffer();

            // Place the image next to the product name and description
            compositeImages.push({ input: productImage, left: 400, top: 20 });  // Adjust image placement
        }

        // Create the text overlay as SVG
        const svg = `<svg width="800" height="200">
            <!-- Product Name -->
            <text x="20" y="${productY}" font-family="Arial, sans-serif" font-size="40" fill="black" font-weight="bold">${text}</text>
            
            <!-- Description -->
            <text x="20" y="${descriptionY}" font-family="Arial, sans-serif" font-size="20" fill="black">${description}</text>

            <!-- Discount Info (positioned right) -->
            <text x="600" y="50" font-family="Arial, sans-serif" font-size="30" fill="red">${discountInfo}</text>

            <!-- Current Price (right next to discount info) -->
            <text x="${priceX}" y="${priceY}" font-family="Arial, sans-serif" font-size="40" fill="black" font-weight="bold">${price}</text>

            <!-- Old Price -->
            <text x="${priceX}" y="${oldPriceY}" font-family="Arial, sans-serif" font-size="20" fill="gray" text-decoration="line-through">${oldPrice}</text>
        </svg>`;

        const svgBuffer = Buffer.from(svg);

        // Add the text overlay as an SVG
        compositeImages.push({ input: svgBuffer, left: 0, top: 0 });

        // Combine all elements (background, product image, and text)
        const imageBuffer = await sharp({
            create: {
                width: 800,
                height: 200,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 1 }
            }
        })
        .composite(compositeImages)
        .png()
        .toBuffer();

        // Add the image buffer to the array
        imageBuffers.push(imageBuffer);
    }

    // Handle grid layout
    const columns = 3;  // Number of product boxes per row
    const boxWidth = 800;
    const boxHeight = 200;
    const totalWidth = columns * boxWidth;
    const totalHeight = Math.ceil(cleanedData.length / columns) * boxHeight;

    // Create the stitched image with grid layout
    const stitchedImagePath = path.join(__dirname, 'public', 'price-sheet.png');
    await sharp({
        create: {
            width: totalWidth,  // Total width for the grid
            height: totalHeight, // Total height for the grid
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
    })
    .composite(
        imageBuffers.map((buffer, index) => ({
            input: buffer,
            top: Math.floor(index / columns) * boxHeight,  // Calculate Y position
            left: (index % columns) * boxWidth  // Calculate X position
        }))
    )
    .png()
    .toFile(stitchedImagePath);

    // Generate a PDF version of the price sheet
    const pdfDoc = await PDFDocument.create();
    const pngImageBytes = fs.readFileSync(stitchedImagePath);
    const pngImage = await pdfDoc.embedPng(pngImageBytes);
    const page = pdfDoc.addPage([totalWidth, totalHeight]);
    page.drawImage(pngImage, {
        x: 0,
        y: 0,
        width: totalWidth,
        height: totalHeight
    });
    const pdfBytes = await pdfDoc.save();

    // Save the PDF file
    const pdfPath = path.join(__dirname, 'public', 'price-sheet.pdf');
    fs.writeFileSync(pdfPath, pdfBytes);

    // Send back the links to download the PNG and PDF files
    res.json({
        message: 'Price sheet generated successfully!',
        imageUrl: '/price-sheet.png',   // Frontend can use this URL to show the PNG image
        pdfUrl: '/price-sheet.pdf'      // URL for downloading the PDF version
    });
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
