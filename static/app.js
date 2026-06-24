// Tab configuration definitions
const tabConfig = {
    'pdf-to-word': {
        title: 'PDF to Word (.docx)',
        desc: 'PDF dosyalarınızı düzenlenebilir Word (.docx) belgelerine yüksek kalitede dönüştürün.',
        multiple: false,
        accept: '.pdf',
        acceptLabel: 'Desteklenen format: .pdf',
        route: '/api/pdf-to-word',
        defaultFilename: 'converted.docx'
    },
    'word-to-pdf': {
        title: 'Word to PDF (.pdf)',
        desc: 'Word (.docx, .doc) dosyalarınızı kolayca PDF formatına dönüştürün.',
        multiple: false,
        accept: '.docx,.doc',
        acceptLabel: 'Desteklenen formatlar: .doc, .docx',
        route: '/api/word-to-pdf',
        defaultFilename: 'converted.pdf'
    },
    'pdf-to-image': {
        title: 'PDF to Image (ZIP)',
        desc: 'PDF belgenizin her sayfasını görsel (PNG veya JPG) olarak dışa aktarın ve ZIP olarak indirin.',
        multiple: false,
        accept: '.pdf',
        acceptLabel: 'Desteklenen format: .pdf',
        route: '/api/pdf-to-image',
        defaultFilename: 'pdf_images.zip'
    },
    'image-to-pdf': {
        title: 'Görsellerden PDF Yapıcı',
        desc: 'Birden fazla görseli (PNG, JPG, WebP) tek bir PDF dosyası halinde birleştirin.',
        multiple: true,
        accept: '.png,.jpg,.jpeg,.webp,.bmp',
        acceptLabel: 'Desteklenen formatlar: .png, .jpg, .jpeg, .webp, .bmp',
        route: '/api/image-to-pdf',
        defaultFilename: 'images_combined.pdf'
    },
    'pdf-merge-encrypt': {
        title: 'PDF Birleştirme & Şifreleme',
        desc: 'Birden fazla PDF belgesini tek bir dosyada birleştirin ve isterseniz şifre koyarak koruyun.',
        multiple: true,
        accept: '.pdf',
        acceptLabel: 'Desteklenen formatlar: Birden çok .pdf',
        route: '/api/pdf-merge-encrypt',
        defaultFilename: 'merged_document.pdf'
    },
    'convert-image': {
        title: 'Görsel Dönüştürücü',
        desc: 'Görsellerinizi WebP, PNG veya JPG formatları arasında hızlıca dönüştürün.',
        multiple: false,
        accept: '.png,.jpg,.jpeg,.webp',
        acceptLabel: 'Desteklenen formatlar: .png, .jpg, .jpeg, .webp',
        route: '/api/convert-image',
        defaultFilename: 'converted_image.png'
    }
};

// State variables
let activeTab = 'pdf-to-word';
let selectedFiles = [];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 Megabytes Limit

// DOM Element Selectors
const navTabs = document.getElementById('nav-tabs');
const toolTitle = document.getElementById('tool-title');
const toolDesc = document.getElementById('tool-desc');
const acceptedFormats = document.getElementById('accepted-formats');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const uploadPrompt = document.getElementById('upload-prompt');
const fileStatus = document.getElementById('file-status');
const fileNameEl = document.getElementById('file-name');
const fileSizeEl = document.getElementById('file-size');
const removeFileBtn = document.getElementById('remove-file-btn');
const optionsPanel = document.getElementById('options-panel');
const progressBox = document.getElementById('progress-box');
const progressStatus = document.getElementById('progress-status');
const progressPercent = document.getElementById('progress-percent');
const progressBar = document.getElementById('progress-bar');
const submitBtn = document.getElementById('submit-btn');
const submitBtnText = document.getElementById('submit-btn-text');
const converterForm = document.getElementById('converter-form');

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    setupTabSwitcher();
    setupDropZone();
    setupFormSubmission();
    updateUIForTab();
});

// Setup sidebar tab selection click handlers
function setupTabSwitcher() {
    navTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tab]');
        if (!btn) return;
        
        // Remove active class styling from all tabs
        const allButtons = navTabs.querySelectorAll('[data-tab]');
        allButtons.forEach(b => {
            b.className = "tab-btn w-full flex items-center justify-between px-4 py-3 rounded-xl text-left text-sm font-medium transition-all duration-200 text-slate-300 hover:bg-slate-800/40 hover:text-white border border-transparent";
            const rightChevron = b.querySelector('[data-lucide="chevron-right"]');
            if (rightChevron) rightChevron.classList.add('opacity-0');
        });
        
        // Set active tab styling
        btn.className = "tab-btn w-full flex items-center justify-between px-4 py-3 rounded-xl text-left text-sm font-medium transition-all duration-200 bg-gradient-to-r from-brand-purple/10 to-brand-indigo/10 text-white border border-brand-purple/30 shadow-md";
        const chevron = btn.querySelector('[data-lucide="chevron-right"]');
        if (chevron) {
            chevron.classList.remove('opacity-0');
            chevron.classList.add('opacity-80');
        }
        
        activeTab = btn.getAttribute('data-tab');
        clearFiles();
        updateUIForTab();
    });
}

// Update UI layout, headings, and input options depending on selected tab
function updateUIForTab() {
    const config = tabConfig[activeTab];
    toolTitle.innerHTML = config.title;
    toolDesc.innerHTML = config.desc;
    acceptedFormats.innerHTML = config.acceptLabel;
    
    fileInput.accept = config.accept;
    fileInput.multiple = config.multiple;
    
    generateOptionsPanel();
    
    // Refresh icons inside dynamic nodes
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// Generate configuration option fields dynamically based on active tool
function generateOptionsPanel() {
    optionsPanel.innerHTML = '';
    optionsPanel.classList.add('hidden');
    
    if (activeTab === 'pdf-to-image') {
        optionsPanel.innerHTML = `
            <div class="flex flex-col space-y-2">
                <label class="text-xs font-semibold text-slate-300">Hedef Görsel Formatı</label>
                <select id="opt-img-format" name="img_format" class="w-full bg-slate-800 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand-purple transition-colors">
                    <option value="png">PNG (Yüksek Kalite & Şeffaflık Korunur)</option>
                    <option value="jpg">JPG (Düşük Dosya Boyutu)</option>
                </select>
            </div>
        `;
        optionsPanel.classList.remove('hidden');
    } else if (activeTab === 'pdf-merge-encrypt') {
        optionsPanel.innerHTML = `
            <div class="flex flex-col space-y-2">
                <div class="flex justify-between items-center">
                    <label class="text-xs font-semibold text-slate-300">PDF Şifre Koruması (Opsiyonel)</label>
                    <span class="text-[10px] text-slate-400">Şifresiz birleştirme için boş bırakın</span>
                </div>
                <div class="relative">
                    <input type="password" id="opt-pdf-password" name="password" placeholder="En az 1 karakter şifre girin..." class="w-full bg-slate-800 border border-slate-700/80 rounded-xl pl-4 pr-12 py-2.5 text-sm text-white focus:outline-none focus:border-brand-purple placeholder-slate-500 transition-colors" />
                    <button type="button" id="toggle-pw-btn" class="absolute right-3.5 top-3 text-slate-400 hover:text-white transition-colors">
                        <i data-lucide="eye" class="w-4.5 h-4.5"></i>
                    </button>
                </div>
            </div>
        `;
        optionsPanel.classList.remove('hidden');
        
        // Add password visibility toggle hook
        const toggleBtn = document.getElementById('toggle-pw-btn');
        const pwInput = document.getElementById('opt-pdf-password');
        if (toggleBtn && pwInput) {
            toggleBtn.addEventListener('click', () => {
                const type = pwInput.getAttribute('type') === 'password' ? 'text' : 'password';
                pwInput.setAttribute('type', type);
                
                const eyeIcon = toggleBtn.querySelector('i');
                if (eyeIcon) {
                    const iconName = type === 'password' ? 'eye' : 'eye-off';
                    eyeIcon.setAttribute('data-lucide', iconName);
                    window.lucide.createIcons();
                }
            });
        }
    } else if (activeTab === 'convert-image') {
        optionsPanel.innerHTML = `
            <div class="flex flex-col space-y-2">
                <label class="text-xs font-semibold text-slate-300">Dönüştürülecek Görsel Formatı</label>
                <select id="opt-target-format" name="target_format" class="w-full bg-slate-800 border border-slate-700/80 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand-purple transition-colors">
                    <option value="png">PNG Formatına Dönüştür</option>
                    <option value="webp">WebP Formatına Dönüştür</option>
                    <option value="jpg">JPG Formatına Dönüştür</option>
                </select>
            </div>
        `;
        optionsPanel.classList.remove('hidden');
    }
}

// Drag & Drop event bindings
function setupDropZone() {
    // Click trigger on drop zone opens file browser
    dropZone.addEventListener('click', (e) => {
        // Prevent looping if clicking remove or inside options
        if (e.target.closest('#remove-file-btn') || e.target.closest('#file-status')) return;
        fileInput.click();
    });
    
    fileInput.addEventListener('change', () => {
        handleSelectedFiles(fileInput.files);
    });
    
    // Drag enters
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('border-brand-purple/70', 'bg-slate-900/50');
        }, false);
    });
    
    // Drag leaves
    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('border-brand-purple/70', 'bg-slate-900/50');
        }, false);
    });
    
    // Drop files
    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleSelectedFiles(files);
    });
    
    // Remove files
    removeFileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearFiles();
    });
}

// Parse selected files list and check sizes
function handleSelectedFiles(files) {
    if (!files || files.length === 0) return;
    
    const config = tabConfig[activeTab];
    let fileArray = Array.from(files);
    
    // Filter by single vs multiple compatibility
    if (!config.multiple) {
        fileArray = [fileArray[0]]; // Grab first file only
    }
    
    // Size check
    let totalSize = fileArray.reduce((acc, f) => acc + f.size, 0);
    if (totalSize > MAX_FILE_SIZE) {
        alert(`Dosya boyutu sınırı aşıldı! Seçilen dosyaların toplam boyutu 50 MB'tan küçük olmalıdır.`);
        return;
    }
    
    selectedFiles = fileArray;
    updateFileDisplay();
}

// Refresh visual indicators of uploaded file list
function updateFileDisplay() {
    if (selectedFiles.length === 0) {
        clearFiles();
        return;
    }
    
    uploadPrompt.classList.add('hidden');
    fileStatus.classList.remove('hidden');
    
    if (selectedFiles.length === 1) {
        const file = selectedFiles[0];
        fileNameEl.textContent = file.name;
        fileSizeEl.textContent = formatBytes(file.size);
    } else {
        fileNameEl.textContent = `${selectedFiles.length} Dosya Seçildi`;
        const totalSize = selectedFiles.reduce((acc, f) => acc + f.size, 0);
        fileSizeEl.textContent = `Toplam Boyut: ${formatBytes(totalSize)}`;
    }
    
    submitBtn.removeAttribute('disabled');
}

// Clear files state and inputs
function clearFiles() {
    selectedFiles = [];
    fileInput.value = '';
    uploadPrompt.classList.remove('hidden');
    fileStatus.classList.add('hidden');
    submitBtn.setAttribute('disabled', 'true');
    resetProgress();
}

// Submit Form (Dönüştürmeyi Başlat) Event Handler
function setupFormSubmission() {
    converterForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (selectedFiles.length === 0) return;
        
        const config = tabConfig[activeTab];
        const formData = new FormData();
        
        // Add files to forms
        if (config.multiple) {
            selectedFiles.forEach(file => {
                formData.append('files', file);
            });
        } else {
            formData.append('file', selectedFiles[0]);
        }
        
        // Add dynamic option parameters
        if (activeTab === 'pdf-to-image') {
            const formatSelect = document.getElementById('opt-img-format');
            formData.append('img_format', formatSelect.value);
        } else if (activeTab === 'pdf-merge-encrypt') {
            const pwInput = document.getElementById('opt-pdf-password');
            if (pwInput && pwInput.value) {
                formData.append('password', pwInput.value);
            }
        } else if (activeTab === 'convert-image') {
            const targetFormatSelect = document.getElementById('opt-target-format');
            formData.append('target_format', targetFormatSelect.value);
        }
        
        executeUpload(config.route, formData);
    });
}

// Send payload using XHR with upload progress monitor
function executeUpload(url, formData) {
    // Disable inputs and display progress bar
    submitBtn.setAttribute('disabled', 'true');
    submitBtnText.textContent = "Dönüştürülüyor...";
    progressBox.classList.remove('hidden');
    updateProgress(0, 'İşlem başlatılıyor...');
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.responseType = 'blob';
    
    // Monitor upload progress state
    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            // Scale upload progress from 0% to 85%
            const uploadPercent = Math.round((e.loaded / e.total) * 85);
            updateProgress(uploadPercent, `Dosyalar sunucuya gönderiliyor... (${Math.round((e.loaded / e.total) * 100)}%)`);
        }
    });
    
    // Server has fully read the file and is performing backend converting tasks
    xhr.addEventListener('readystatechange', () => {
        if (xhr.readyState === 3) {
            // Upload completed, conversion underway
            updateProgress(90, 'Dosyalar dönüştürülüyor... Lütfen sayfayı kapatmayın.');
        }
    });
    
    xhr.onload = function() {
        if (xhr.status === 200) {
            updateProgress(100, 'Tamamlandı! İndirme işlemi başlatılıyor...');
            
            // Extract filename from response headers if present
            let filename = tabConfig[activeTab].defaultFilename;
            const disposition = xhr.getResponseHeader('Content-Disposition');
            if (disposition && disposition.indexOf('attachment') !== -1) {
                const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                const matches = filenameRegex.exec(disposition);
                if (matches != null && matches[1]) { 
                    filename = matches[1].replace(/['"]/g, '');
                }
            }
            
            // Read output stream as Blob URL and trigger window download click
            const blob = xhr.response;
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = downloadUrl;
            a.download = decodeURIComponent(filename);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(downloadUrl);
            
            // Success reset
            setTimeout(() => {
                resetUI();
            }, 2500);
        } else {
            // Read error response from blob output
            const reader = new FileReader();
            reader.onload = function() {
                let errorMsg = "Dönüştürme işlemi sırasında bir sunucu hatası oluştu.";
                try {
                    const parsedError = JSON.parse(reader.result);
                    if (parsedError && parsedError.detail) {
                        errorMsg = `Hata: ${parsedError.detail}`;
                    }
                } catch(e) {}
                alert(errorMsg);
                resetProgress();
            };
            reader.readAsText(xhr.response);
        }
    };
    
    xhr.onerror = function() {
        alert("Bağlantı hatası: Sunucuyla bağlantı kurulamadı.");
        resetProgress();
    };
    
    xhr.send(formData);
}

// Helper to update progress status and progress bar widths
function updateProgress(percent, statusText) {
    progressBar.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
    progressStatus.innerHTML = `
        <i data-lucide="loader" class="w-3.5 h-3.5 animate-spin text-brand-purple"></i>
        ${statusText}
    `;
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// Reset progress indicators
function resetProgress() {
    progressBox.classList.add('hidden');
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    submitBtn.removeAttribute('disabled');
    submitBtnText.textContent = "Dönüştürmeyi Başlat";
}

// Reset entire tool card UI
function resetUI() {
    clearFiles();
    resetProgress();
}

// Helper utility to human-format byte counts
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
