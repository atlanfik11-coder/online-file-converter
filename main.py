import os
import shutil
import tempfile
import uuid
import subprocess
import zipfile
import asyncio
import logging
from typing import List
from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pdf2docx import Converter
from pdf2image import convert_from_path
from pypdf import PdfMerger, PdfReader, PdfWriter

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Online File Converter API",
    description="Backend API for completely free All-in-One Online File Converter",
    version="1.0.0"
)

# Background task to clean up the temporary directory after a delay
async def cleanup_temp_dir(dir_path: str, delay: int = 180):
    """
    Asynchronously deletes the temporary directory and all its contents after a delay (default 3 minutes).
    This delay ensures the client has started and finished downloading the file.
    """
    await asyncio.sleep(delay)
    try:
        if os.path.exists(dir_path):
            shutil.rmtree(dir_path)
            logger.info(f"Successfully cleaned up temporary directory: {dir_path}")
    except Exception as e:
        logger.error(f"Error while cleaning up directory {dir_path}: {str(e)}")

# Ensure /tmp folder exists (FastAPI temp directory fallback)
temp_base_dir = os.path.join(tempfile.gettempdir(), "file_converter")
os.makedirs(temp_base_dir, exist_ok=True)

def create_request_temp_dir() -> str:
    """Creates a unique directory for the lifetime of a conversion request."""
    return tempfile.mkdtemp(dir=temp_base_dir, prefix="req_")

# 1. PDF to Word (.docx)
@app.post("/api/pdf-to-word")
async def pdf_to_word(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...)
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported for this operation.")
    
    temp_dir = create_request_temp_dir()
    input_path = os.path.join(temp_dir, "input.pdf")
    output_path = os.path.join(temp_dir, "converted.docx")
    
    try:
        # Save uploaded PDF file
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Run conversion
        cv = Converter(input_path)
        cv.convert(output_path, start=0, end=None)
        cv.close()
        
        if not os.path.exists(output_path):
            raise Exception("pdf2docx conversion failed to generate output file.")
        
        # Schedule cleanup task (3 minutes delay)
        background_tasks.add_task(cleanup_temp_dir, temp_dir)
        
        return FileResponse(
            path=output_path,
            filename=f"{os.path.splitext(file.filename)[0]}.docx",
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
    except Exception as e:
        logger.error(f"PDF to Word conversion failed: {str(e)}")
        # If it failed immediately, clean up the directory right away
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        raise HTTPException(status_code=500, detail=f"Conversion error: {str(e)}")

# 2. Word (.docx) to PDF
@app.post("/api/word-to-pdf")
async def word_to_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...)
):
    if not file.filename.lower().endswith((".docx", ".doc")):
        raise HTTPException(status_code=400, detail="Only Word documents (.doc, .docx) are supported.")
    
    temp_dir = create_request_temp_dir()
    input_path = os.path.join(temp_dir, file.filename)
    
    try:
        # Save uploaded docx file
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Run LibreOffice headless conversion
        # command: libreoffice --headless --convert-to pdf --outdir [temp_dir] [input_path]
        cmd = [
            "libreoffice",
            "--headless",
            "--convert-to", "pdf",
            "--outdir", temp_dir,
            input_path
        ]
        
        logger.info(f"Running LibreOffice conversion command: {' '.join(cmd)}")
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=90)
        
        if result.returncode != 0:
            logger.error(f"LibreOffice stdout: {result.stdout}")
            logger.error(f"LibreOffice stderr: {result.stderr}")
            raise Exception(f"LibreOffice conversion failed: {result.stderr}")
        
        # LibreOffice names the output file by replacing the extension with .pdf
        base_name = os.path.splitext(file.filename)[0]
        output_path = os.path.join(temp_dir, f"{base_name}.pdf")
        
        if not os.path.exists(output_path):
            raise Exception("Output PDF file was not created by LibreOffice.")
        
        # Schedule cleanup
        background_tasks.add_task(cleanup_temp_dir, temp_dir)
        
        return FileResponse(
            path=output_path,
            filename=f"{base_name}.pdf",
            media_type="application/pdf"
        )
    except Exception as e:
        logger.error(f"Word to PDF conversion failed: {str(e)}")
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        raise HTTPException(status_code=500, detail=f"Conversion error: {str(e)}")

# 3. PDF to Image (JPG/PNG) - Returns a ZIP file
@app.post("/api/pdf-to-image")
async def pdf_to_image(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    img_format: str = Form("png")  # png or jpg
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    
    img_format = img_format.lower()
    if img_format not in ["png", "jpg", "jpeg"]:
        raise HTTPException(status_code=400, detail="Invalid image format. Supported formats are png and jpg.")
    
    temp_dir = create_request_temp_dir()
    input_path = os.path.join(temp_dir, "input.pdf")
    zip_filename = f"{os.path.splitext(file.filename)[0]}_images.zip"
    zip_path = os.path.join(temp_dir, zip_filename)
    
    try:
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Convert pages to images
        images = convert_from_path(input_path)
        
        if not images:
            raise Exception("No pages could be extracted from PDF.")
        
        # Write images to temporary directory and zip them
        with zipfile.ZipFile(zip_path, 'w') as zip_file:
            for i, img in enumerate(images):
                img_name = f"page_{i+1}.{img_format}"
                img_path = os.path.join(temp_dir, img_name)
                
                # Save image
                save_format = "PNG" if img_format == "png" else "JPEG"
                if save_format == "JPEG" and img.mode in ("RGBA", "LA"):
                    # Convert transparent background to white for JPEGs
                    bg = Image.new("RGB", img.size, (255, 255, 255))
                    bg.paste(img, mask=img.split()[3] if img.mode == "RGBA" else img.split()[1])
                    bg.save(img_path, save_format)
                else:
                    img.save(img_path, save_format)
                
                # Add to ZIP
                zip_file.write(img_path, img_name)
        
        background_tasks.add_task(cleanup_temp_dir, temp_dir)
        
        return FileResponse(
            path=zip_path,
            filename=zip_filename,
            media_type="application/zip"
        )
    except Exception as e:
        logger.error(f"PDF to Image conversion failed: {str(e)}")
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        raise HTTPException(status_code=500, detail=f"Conversion error: {str(e)}")

# 4. Image to PDF
@app.post("/api/image-to-pdf")
async def image_to_pdf(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...)
):
    if not files:
        raise HTTPException(status_code=400, detail="At least one image file must be uploaded.")
    
    temp_dir = create_request_temp_dir()
    pdf_path = os.path.join(temp_dir, "converted_images.pdf")
    
    try:
        pil_images = []
        for file in files:
            ext = os.path.splitext(file.filename)[1].lower()
            if ext not in [".jpg", ".jpeg", ".png", ".webp", ".bmp"]:
                logger.warning(f"Skipping unsupported image format: {file.filename}")
                continue
            
            file_path = os.path.join(temp_dir, file.filename)
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            img = Image.open(file_path)
            # Convert to RGB mode (PDF standard)
            if img.mode != "RGB":
                img = img.convert("RGB")
            pil_images.append(img)
        
        if not pil_images:
            raise HTTPException(status_code=400, detail="No valid images were uploaded.")
        
        # Save all images into a single PDF
        pil_images[0].save(
            pdf_path,
            save_all=True,
            append_images=pil_images[1:]
        )
        
        background_tasks.add_task(cleanup_temp_dir, temp_dir)
        
        return FileResponse(
            path=pdf_path,
            filename="images_combined.pdf",
            media_type="application/pdf"
        )
    except Exception as e:
        logger.error(f"Image to PDF conversion failed: {str(e)}")
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        raise HTTPException(status_code=500, detail=f"Conversion error: {str(e)}")

# 5. PDF Merger & Encrypter
@app.post("/api/pdf-merge-encrypt")
async def pdf_merge_encrypt(
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    password: str = Form(None)
):
    if not files:
        raise HTTPException(status_code=400, detail="At least one PDF file is required.")
    
    temp_dir = create_request_temp_dir()
    merged_path = os.path.join(temp_dir, "merged.pdf")
    
    try:
        merger = PdfMerger()
        pdf_count = 0
        
        for file in files:
            if not file.filename.lower().endswith(".pdf"):
                logger.warning(f"Skipping non-PDF file: {file.filename}")
                continue
            
            file_path = os.path.join(temp_dir, f"file_{pdf_count}.pdf")
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            merger.append(file_path)
            pdf_count += 1
            
        if pdf_count == 0:
            raise HTTPException(status_code=400, detail="No valid PDF files were uploaded.")
        
        merger.write(merged_path)
        merger.close()
        
        output_path = merged_path
        
        # Apply password encryption if requested
        if password:
            reader = PdfReader(merged_path)
            writer = PdfWriter()
            
            for page in reader.pages:
                writer.add_page(page)
                
            writer.encrypt(password)
            encrypted_path = os.path.join(temp_dir, "merged_secured.pdf")
            
            with open(encrypted_path, "wb") as f:
                writer.write(f)
            output_path = encrypted_path
            
        background_tasks.add_task(cleanup_temp_dir, temp_dir)
        
        output_filename = "secured_document.pdf" if password else "merged_document.pdf"
        return FileResponse(
            path=output_path,
            filename=output_filename,
            media_type="application/pdf"
        )
    except Exception as e:
        logger.error(f"PDF merge/encrypt operation failed: {str(e)}")
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        raise HTTPException(status_code=500, detail=f"Operation error: {str(e)}")

# 6. Image Converter (Format conversion)
@app.post("/api/convert-image")
async def convert_image(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    target_format: str = Form(...)  # png, jpg, webp
):
    target_format = target_format.lower()
    if target_format not in ["png", "jpg", "jpeg", "webp"]:
        raise HTTPException(status_code=400, detail="Unsupported target image format.")
    
    temp_dir = create_request_temp_dir()
    input_path = os.path.join(temp_dir, file.filename)
    
    ext = "jpg" if target_format in ["jpg", "jpeg"] else target_format
    output_filename = f"converted.{ext}"
    output_path = os.path.join(temp_dir, output_filename)
    
    try:
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        img = Image.open(input_path)
        save_format = "PNG"
        if target_format in ["jpg", "jpeg"]:
            save_format = "JPEG"
        elif target_format == "webp":
            save_format = "WEBP"
            
        # If target is JPEG, flatten transparency to white background
        if save_format == "JPEG" and img.mode in ("RGBA", "LA"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3] if img.mode == "RGBA" else img.split()[1])
            bg.save(output_path, save_format)
        else:
            img.save(output_path, save_format)
            
        background_tasks.add_task(cleanup_temp_dir, temp_dir)
        
        orig_name_no_ext = os.path.splitext(file.filename)[0]
        return FileResponse(
            path=output_path,
            filename=f"{orig_name_no_ext}.{ext}",
            media_type=f"image/{ext}"
        )
    except Exception as e:
        logger.error(f"Image conversion failed: {str(e)}")
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        raise HTTPException(status_code=500, detail=f"Conversion error: {str(e)}")

# Serve Static files and HTML index
@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index_path = os.path.join("static", "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return """
    <html>
        <head><title>Online File Converter</title></head>
        <body style="font-family:sans-serif; text-align:center; padding-top:50px;">
            <h1>Online File Converter</h1>
            <p>Static index.html is missing. Please check backend files.</p>
        </body>
    </html>
    """

# Mount the static directory for app.js and stylesheet assets
app.mount("/static", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    import uvicorn
    # Locally bind to 0.0.0.0:8000 for server environments
    uvicorn.run(app, host="0.0.0.0", port=8000)
