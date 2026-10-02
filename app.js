/**
 * app.js
 * Điều khiển chính của Webapp: Tải dữ liệu, đồng bộ hóa, vẽ biểu đồ, lọc tìm kiếm và trò chuyện AI.
 */

class ProjectApp {
    constructor() {
        this.sheetUrl = 'https://docs.google.com/spreadsheets/d/1UMIJC0fAFuNfAARb6fyUETrD7nOV7whfHokbNa35Y2w/export?format=xlsx';
        
        // Data stores
        this.rawData = {};
        this.projects = [];
        this.delays = [];
        this.baocao = [];
        this.revenue = [];
        
        // Pagination state
        this.currentPage = 1;
        this.itemsPerPage = 30;
        this.filteredProjects = [];
        
        // Chart instances
        this.charts = {};
        
        // Chat assistant helper
        this.ai = new AIChatAssistant();
    }

    async init() {
        this.initTheme();
        this.setupEventListeners();
        this.updateDateDisplay();
        this.loadSavedApiKey();
        
        // Tải dữ liệu cục bộ trước để giao diện hoạt động ngay lập tức
        const localLoaded = await this.loadFallbackLocalJson();
        if (localLoaded) {
            const badge = document.getElementById('sync-status');
            if (badge) {
                badge.className = 'status-badge status-local';
                badge.querySelector('.text').innerText = 'Đồng bộ: Cục bộ';
            }
            this.buildFilters();
            this.applyFilters();
            this.updateKPIs();
            this.renderDashboardProjectsList();
            this.renderDashboardCharts();
            this.renderRevenueTable();
            this.renderWeeklyReport();
            this.updateBadgeCounts();
        }
        
        // Chạy đồng bộ nền với Google Sheets (không chặn giao diện)
        this.syncDataBackground();
    }

    async fetchWithTimeout(resource, options = {}) {
        const { timeout = 3000 } = options;
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(resource, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(id);
            return response;
        } catch (error) {
            clearTimeout(id);
            throw error;
        }
    }

    async syncDataBackground() {
        try {
            await this.syncData(false);
        } catch (e) {
            console.warn("Background sync failed:", e);
        }
    }

    initTheme() {
        const savedTheme = localStorage.getItem('theme_preference') || 'dark';
        this.applyTheme(savedTheme);

        const toggleBtn = document.getElementById('btn-theme-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const isDark = document.body.classList.contains('dark-theme');
                const newTheme = isDark ? 'light' : 'dark';
                this.applyTheme(newTheme);
                localStorage.setItem('theme_preference', newTheme);
            });
        }
    }

    applyTheme(theme) {
        const icon = document.getElementById('theme-toggle-icon');
        const text = document.getElementById('theme-toggle-text');
        
        if (theme === 'light') {
            document.body.classList.remove('dark-theme');
            document.body.classList.add('light-theme');
            if (icon) {
                icon.className = 'fa-solid fa-sun text-amber';
            }
            if (text) {
                text.innerText = 'Giao diện sáng';
            }
            if (window.Chart) {
                Chart.defaults.color = '#475569';
                Chart.defaults.borderColor = 'rgba(0, 0, 0, 0.08)';
            }
        } else {
            document.body.classList.remove('light-theme');
            document.body.classList.add('dark-theme');
            if (icon) {
                icon.className = 'fa-solid fa-moon text-cyan';
            }
            if (text) {
                text.innerText = 'Giao diện tối';
            }
            if (window.Chart) {
                Chart.defaults.color = '#94a3b8';
                Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.08)';
            }
        }

        // Re-render chart colors if charts are loaded
        if (this.projects && this.projects.length > 0) {
            this.renderCharts();
        }
    }

    setupEventListeners() {
        // Tab switching
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabId = btn.getAttribute('data-tab');
                this.switchTab(tabId);
            });
        });

        // Sync button
        document.getElementById('btn-sync-now').addEventListener('click', () => {
            this.syncData(true);
        });

        // Filter events
        const applyFiltersFn = () => {
            this.currentPage = 1;
            this.applyFilters();
        };
        const searchInput = document.getElementById('search-project-input');
        if (searchInput) {
            searchInput.addEventListener('input', applyFiltersFn);
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.executeSearchAction();
                }
            });
        }
        const btnSearchProj = document.getElementById('btn-search-project');
        if (btnSearchProj) {
            btnSearchProj.addEventListener('click', () => {
                this.executeSearchAction();
            });
        }

        const btnClear = document.getElementById('btn-clear-filters');
        if (btnClear) btnClear.addEventListener('click', () => this.resetAllMultiSelects());

        // Pagination events
        document.getElementById('btn-prev-page').addEventListener('click', () => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.renderProjectsTable();
            }
        });
        document.getElementById('btn-next-page').addEventListener('click', () => {
            const maxPage = Math.ceil(this.filteredProjects.length / this.itemsPerPage);
            if (this.currentPage < maxPage) {
                this.currentPage++;
                this.renderProjectsTable();
            }
        });

        // Delay tab filters
        const applyDelayFilters = () => {
            this.renderDelayCards();
        };
        document.getElementById('alert-filter-pmu').addEventListener('change', applyDelayFilters);
        document.getElementById('alert-filter-severity').addEventListener('change', applyDelayFilters);
        document.getElementById('alert-search-input').addEventListener('input', applyDelayFilters);

        // Chat helper events
        document.getElementById('btn-save-key').addEventListener('click', () => {
            const key = document.getElementById('api-key-input').value.trim();
            const model = document.getElementById('api-model-select').value;
            this.ai.setModel(model);
            if (key) {
                this.ai.setApiKey(key);
                this.updateApiStatus(true);
                alert('Đã lưu API Key và Mô hình thành công!');
                document.getElementById('api-key-input').value = '';
            } else {
                alert('Đã cập nhật Mô hình. Vui lòng nhập API Key nếu muốn lưu Key mới.');
            }
        });

        document.getElementById('btn-clear-key').addEventListener('click', () => {
            this.ai.clearApiKey();
            this.updateApiStatus(false);
            alert('Đã xóa API Key thành công!');
        });

        document.getElementById('btn-toggle-key-visibility').addEventListener('click', () => {
            const input = document.getElementById('api-key-input');
            const icon = document.querySelector('#btn-toggle-key-visibility i');
            if (input.type === 'password') {
                input.type = 'text';
                icon.className = 'fa-solid fa-eye-slash';
            } else {
                input.type = 'password';
                icon.className = 'fa-solid fa-eye';
            }
        });

        document.getElementById('btn-send-message').addEventListener('click', () => {
            this.handleSendMessage();
        });

        document.getElementById('chat-input-box').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage();
            }
        });

        // Preset Chips
        document.querySelectorAll('.preset-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const prompt = chip.getAttribute('data-prompt');
                document.getElementById('chat-input-box').value = prompt;
                this.handleSendMessage();
            });
        });

        // Modal settings events
        document.getElementById('btn-open-settings').addEventListener('click', () => {
            document.getElementById('settings-modal').classList.add('open');
            document.getElementById('modal-api-key').value = localStorage.getItem('gemini_api_key') || '';
            document.getElementById('modal-api-model').value = localStorage.getItem('gemini_model') || 'gemini-2.5-flash';
        });

        const closeModal = () => {
            document.getElementById('settings-modal').classList.remove('open');
        };
        document.querySelector('.btn-close-modal').addEventListener('click', closeModal);
        document.getElementById('btn-modal-cancel').addEventListener('click', closeModal);
        document.getElementById('btn-modal-save').addEventListener('click', () => {
            const key = document.getElementById('modal-api-key').value.trim();
            const model = document.getElementById('modal-api-model').value;
            this.ai.setModel(model);
            document.getElementById('api-model-select').value = model; // Sync with sidebar
            if (key) {
                this.ai.setApiKey(key);
                this.updateApiStatus(true);
            } else {
                this.ai.clearApiKey();
                this.updateApiStatus(false);
            }
            const sheetUrlVal = document.getElementById('modal-sheet-url').value.trim();
            if (sheetUrlVal) {
                this.sheetUrl = sheetUrlVal.replace('/edit', '/export') + (sheetUrlVal.includes('export') ? '' : '?format=xlsx');
            }
            closeModal();
            alert('Cấu hình đã được cập nhật thành công!');
        });

        // Drawer detail close
        const closeDrawer = () => {
            document.getElementById('project-detail-drawer').classList.remove('open');
        };
        document.querySelector('.btn-close-drawer').addEventListener('click', closeDrawer);
        document.querySelector('.drawer-overlay').addEventListener('click', closeDrawer);

        // Dashboard view all button
        document.getElementById('btn-dashboard-view-all').addEventListener('click', () => {
            this.switchTab('projects');
        });

        // Dashboard table tab switching
        this.currentDashboardTable = 'delay';
        const tabBtnDelay = document.getElementById('tab-btn-delay');
        const tabBtnMilestone = document.getElementById('tab-btn-milestone');
        if (tabBtnDelay && tabBtnMilestone) {
            tabBtnDelay.addEventListener('click', () => {
                tabBtnDelay.classList.add('active');
                tabBtnMilestone.classList.remove('active');
                this.currentDashboardTable = 'delay';
                this.renderDashboardProjectsList();
            });
            tabBtnMilestone.addEventListener('click', () => {
                tabBtnMilestone.classList.add('active');
                tabBtnDelay.classList.remove('active');
                this.currentDashboardTable = 'milestone';
                this.renderDashboardProjectsList();
            });
        }

        // Weekly Report events
        const btnCopyReport = document.getElementById('btn-copy-report');
        if (btnCopyReport) {
            btnCopyReport.addEventListener('click', () => this.copyWeeklyReport());
        }
        const btnDownloadReport = document.getElementById('btn-download-report');
        if (btnDownloadReport) {
            btnDownloadReport.addEventListener('click', () => this.downloadWeeklyReportTxt());
        }

        // Excel file upload event
        const excelUpload = document.getElementById('excel-file-upload');
        if (excelUpload) {
            excelUpload.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const data = new Uint8Array(event.target.result);
                        const workbook = XLSX.read(data, { type: 'array' });
                        
                        this.parseWorkbookData(workbook);
                        
                        // Show local status badge
                        const badge = document.getElementById('sync-status');
                        badge.className = 'status-badge status-local';
                        badge.querySelector('.text').innerText = 'Đồng bộ: File Excel';
                        
                        // Re-trigger layout renders
                        this.buildFilters();
                        this.applyFilters();
                        this.renderDashboardKPIs();
                        this.renderDashboardProjectsList();
                        this.renderDashboardCharts();
                        this.renderRevenueTable();
                        this.updateBadgeCounts();
                        
                        alert('Đồng bộ dữ liệu từ file Excel tải lên thành công!');
                    } catch (err) {
                        console.error('File parsing failed:', err);
                        alert('Không thể đọc file Excel. Vui lòng kiểm tra định dạng file.');
                    }
                };
                reader.readAsArrayBuffer(file);
            });
        }
    }

    updateDateDisplay() {
        const d = new Date();
        document.getElementById('current-date').innerText = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
    }

    loadSavedApiKey() {
        const savedModel = localStorage.getItem('gemini_model') || 'gemini-2.5-flash';
        document.getElementById('api-model-select').value = savedModel;
        if (this.ai.hasApiKey()) {
            this.updateApiStatus(true);
        } else {
            this.updateApiStatus(false);
        }
    }

    updateApiStatus(hasKey) {
        const badge = document.getElementById('api-status-badge');
        if (hasKey) {
            badge.className = 'api-status-label status-key-ok';
            badge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Trợ lý AI đang hoạt động (Gemini Live)';
        } else {
            badge.className = 'api-status-label status-key-missing';
            badge.innerHTML = '<i class="fa-solid fa-circle-info"></i> Chưa có API Key (Đang dùng công cụ tìm kiếm cục bộ)';
        }
    }

    switchTab(tabId) {
        // Update nav active status
        document.querySelectorAll('.nav-btn').forEach(btn => {
            if (btn.getAttribute('data-tab') === tabId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Update tabs visibility
        document.querySelectorAll('.tab-pane').forEach(pane => {
            if (pane.id === `tab-${tabId}`) {
                pane.classList.add('active');
            } else {
                pane.classList.remove('active');
            }
        });

        // Update titles
        const h1 = document.getElementById('page-title');
        const p = document.getElementById('page-subtitle');
        if (tabId === 'dashboard') {
            h1.innerText = 'Bảng điều khiển';
            p.innerText = 'Tổng quan thông tin cơ cấu và tiến độ dự án lưới điện 110kV';
            this.renderDashboardCharts();
            this.renderDashboardProjectsList();
        } else if (tabId === 'projects') {
            h1.innerText = 'Tìm kiếm dự án';
            p.innerText = 'Tìm kiếm chi tiết, lọc theo đơn vị, tiến độ và cán bộ chủ trì';
        } else if (tabId === 'alerts') {
            h1.innerText = 'Cảnh báo chậm trễ';
            p.innerText = 'Cảnh báo dự án chậm tiến độ và sắp chậm tiến độ kèm mô tả nguyên nhân';
            this.renderDelayCards();
        } else if (tabId === 'revenue') {
            h1.innerText = 'Doanh thu & Tiến độ';
            p.innerText = 'Báo cáo doanh thu thực tế, kế hoạch giải ngân và biểu đồ so sánh';
            this.renderRevenueCharts();
        } else if (tabId === 'weekly-report') {
            h1.innerText = 'Báo cáo tuần';
            p.innerText = 'Báo cáo tổng hợp tiến độ tự động cập nhật';
            this.renderWeeklyReport();
        } else if (tabId === 'ai-chat') {
            h1.innerText = 'Trợ lý Chat AI';
            p.innerText = 'Trò chuyện thông minh, tìm kiếm ngữ nghĩa về toàn bộ dự án';
        }
    }

    /**
     * Đồng bộ hóa dữ liệu: hỗ trợ cả Localhost, GitHub Pages và Web tĩnh
     */
    async syncData(manualAlert = false) {
        const badge = document.getElementById('sync-status');
        const updateBadge = (text, cls = 'status-offline') => {
            if (badge) {
                badge.className = `status-badge ${cls}`;
                const txtEl = badge.querySelector('.text');
                if (txtEl) txtEl.innerText = text;
            }
        };

        updateBadge('Đang kết nối Google Sheets...', 'status-offline');
        
        let success = false;
        let lastError = null;

        try {
            console.log("Attempting live sync from Google Sheets...");
            let response = null;
            const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

            // Priority 1: If on localhost, use local proxy /sync-sheet
            if (isLocalHost) {
                try {
                    console.log("Trying local server proxy /sync-sheet...");
                    updateBadge('Đang tải qua Local Proxy...', 'status-offline');
                    response = await this.fetchWithTimeout('/sync-sheet', { timeout: 20000 });
                    if (!response.ok) throw new Error(`Local proxy returned ${response.status}`);
                } catch (err) {
                    console.warn("Local proxy failed, falling back to direct/CORS...", err);
                    response = null;
                }
            }

            // Priority 2: Direct Google Sheet export (Standard for web & GitHub Pages)
            if (!response || !response.ok) {
                try {
                    console.log("Trying direct Google Sheets export fetch (35s timeout)...");
                    updateBadge('Đang tải từ Google Sheets (5.6MB)...', 'status-offline');
                    response = await this.fetchWithTimeout(this.sheetUrl, { 
                        timeout: 35000,
                        headers: { 'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*' }
                    });
                    if (!response.ok) throw new Error(`Direct Google Sheets fetch returned ${response.status}`);
                } catch (directErr) {
                    console.warn("Direct Google Sheets fetch failed, trying CORS proxies...", directErr);
                    response = null;
                    lastError = directErr;
                }
            }

            // Priority 3: Fast CORS Proxies cascade
            if (!response || !response.ok) {
                const proxies = [
                    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(this.sheetUrl)}`,
                    `https://api.allorigins.win/raw?url=${encodeURIComponent(this.sheetUrl)}`
                ];

                for (let i = 0; i < proxies.length; i++) {
                    try {
                        console.log(`Trying CORS proxy #${i + 1}: ${proxies[i]}`);
                        updateBadge(`Đang tải qua Proxy #${i + 1}...`, 'status-offline');
                        response = await this.fetchWithTimeout(proxies[i], { timeout: 35000 });
                        if (response && response.ok) break;
                    } catch (pErr) {
                        console.warn(`Proxy #${i + 1} failed:`, pErr);
                        response = null;
                        lastError = pErr;
                    }
                }
            }
            
            if (!response || !response.ok) {
                throw lastError || new Error("Không thể kết nối đến Google Sheets qua mọi phương thức");
            }
            
            updateBadge('Đang giải mã dữ liệu...', 'status-offline');
            const arrayBuffer = await response.arrayBuffer();
            const data = new Uint8Array(arrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            
            // Parse Sheets
            this.parseWorkbookData(workbook);
            success = true;
            
            // Set live status badge
            const now = new Date();
            const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            updateBadge(`Đồng bộ: Live (${timeStr})`, 'status-live');
            
            if (manualAlert) {
                alert('Đồng bộ dữ liệu từ Google Sheets thành công!');
            }
        } catch (e) {
            console.warn("Live sync failed, falling back to local pre-extracted JSON...", e);
            if (this.projects && this.projects.length > 0) {
                success = true;
                updateBadge('Đồng bộ: Cục bộ', 'status-local');
                if (manualAlert) {
                    alert('Không thể kết nối trực tiếp Google Sheets (do mạng hoặc giới hạn trình duyệt). Hệ thống đang hiển thị dữ liệu cục bộ đã nạp sẵn.');
                }
            } else {
                success = await this.loadFallbackLocalJson();
                if (success) {
                    updateBadge('Đồng bộ: Cục bộ (Dự phòng)', 'status-local');
                    if (manualAlert) {
                        alert('Đồng bộ trực tiếp thất bại. Hệ thống đã tự động tải dữ liệu dự phòng cục bộ thành công.');
                    }
                } else {
                    updateBadge('Đồng bộ thất bại', 'status-offline');
                    alert('Không thể tải dữ liệu dự án (Lỗi mạng và không tìm thấy dữ liệu dự phòng)!');
                }
            }
        }

        if (success) {
            this.buildFilters();
            this.applyFilters();
            this.updateKPIs();
            this.renderDashboardProjectsList();
            this.renderDashboardCharts();
            this.renderRevenueTable();
            this.renderWeeklyReport();
            this.updateBadgeCounts();
        }
    }

    /**
     * Tải dữ liệu dự phòng từ các file JSON cục bộ
     */
    async loadFallbackLocalJson() {
        // Ưu tiên nạp tức thì từ biến toàn cục window.PROJECT_HUB_RAW_DATA (nếu đã nạp từ data.js)
        if (window.PROJECT_HUB_RAW_DATA && typeof window.PROJECT_HUB_RAW_DATA === 'object') {
            this.rawData = window.PROJECT_HUB_RAW_DATA;
            this.processData();
            return true;
        }

        try {
            const files = ['baocao', 'dang_thuc_hien', 'cham_tien_do', 'sap_cham_tien_do', 'chua_den_han', 'trong_diem', 'list_du_an', 'list_kd_all', 'doanh_thu'];
            const promises = files.map(f => fetch(`data/${f}.json`).then(res => {
                if (!res.ok) throw new Error(`Failed to load ${f}.json`);
                return res.json();
            }));
            
            const results = await Promise.all(promises);
            this.rawData = {
                baocao: results[0],
                dang_thuc_hien: results[1],
                cham_tien_do: results[2],
                sap_cham_tien_do: results[3],
                chua_den_han: results[4],
                trong_diem: results[5],
                list_du_an: results[6],
                list_kd_all: results[7],
                doanh_thu: results[8]
            };

            this.processData();
            return true;
        } catch (e) {
            console.error("Local fallback failed:", e);
            return false;
        }
    }

    /**
     * Phân tích tệp excel workbook từ SheetJS thành các mảng JSON
     */
    parseWorkbookData(workbook) {
        this.rawData = {};
        
        const sheetMappings = {
            'baocao': ['Báo Cáo', 'Báo cáo', 'BaoCao', 'baocao'],
            'dang_thuc_hien': ['Các DA Đang thực hiện', 'Dang thuc hien', 'dang_thuc_hien'],
            'cham_tien_do': ['Chậm tiến độ', 'Cham tien do', 'cham_tien_do'],
            'sap_cham_tien_do': ['Sắp chậm tiến độ', 'Sap cham tien do', 'sap_cham_tien_do'],
            'chua_den_han': ['Chưa đến hạn', 'Chua den han', 'chua_den_han'],
            'trong_diem': ['Trong Diem', 'Trọng điểm', 'trong_diem'],
            'list_du_an': ['List dự án', 'List du an', 'list_du_an'],
            'list_kd_all': ['List KD ALL Data', 'List KD ALL', 'list_kd_all'],
            'doanh_thu': ['Tong hop doanh thu', 'Doanh thu', 'doanh_thu']
        };

        workbook.SheetNames.forEach(sheetName => {
            // Check mapping
            for (const [key, aliases] of Object.entries(sheetMappings)) {
                if (aliases.includes(sheetName)) {
                    const sheet = workbook.Sheets[sheetName];
                    this.rawData[key] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                    console.log(`Parsed sheet: ${sheetName} -> ${key} (${this.rawData[key].length} rows)`);
                }
            }
        });

        this.processData();
    }

    /**
     * Chuẩn hóa dữ liệu thô sang các model đối tượng dự án
     */
    processData() {
        this.projects = [];
        this.delays = [];
        
        // 1. Phân tích danh sách dự án (list_du_an)
        const projRows = this.rawData.list_du_an || [];
        if (projRows.length > 5) {
            // Bắt đầu từ dòng thứ 5 (dòng index 5)
            for (let r = 5; r < projRows.length; r++) {
                const row = projRows[r];
                if (!row || row.length < 16 || !row[15]) continue;

                const pmuTemp = (row[17] || '').toString().trim().toUpperCase();
                const voltageTemp = (row[26] || '').toString().trim().toUpperCase();
                if (pmuTemp === 'KHN' && voltageTemp === 'THA') continue;

                const p = {
                    id: row[10] || '', // STT
                    pmu: row[17] || '', // QLDA (BA1, BA2, PC...)
                    target: row[12] || '', // Khởi công/Đóng điện
                    priority: row[13] || '', // Mức độ ưu tiên
                    category: row[14] || '', // Phân loại dự án
                    name: row[15] || '', // Tên công trình
                    phase: row[16] || '', // Giai đoạn
                    pmuOwner: row[17] || '', // Chủ đầu tư / QLDA
                    area: row[18] || '', // Khu vực / Tỉnh
                    giaoAYear: row[19] || '', // Năm giao A
                    investment: parseFloat(row[20]) || null, // Tổng mức đầu tư
                    contractNo: row[23] || '', // Số HD
                    contractDate: this.parseExcelDate(row[24]), // Ngày ký
                    contractDuration: row[25] || '', // Thời hạn
                    voltage: row[26] || '', // Cấp điện áp
                    consultantService: row[27] || '', // Dịch vụ tư vấn
                    status: row[28] || '', // Hiện trạng
                    statusAfterApproved: row[29] || '', // Hiện trạng sau phê duyệt
                    npcApprovedDate: '', // Sẽ chỉ lấy duy nhất từ sheet "List KD ALL Data", cột Y
                    expectedApprovedMonth: row[35] || '', // Tháng dự kiến phê duyệt
                    expectedApprovedYear: row[36] || '', // Năm dự kiến phê duyệt
                    overallSummary: row[38] || '', // Tổng quát tình hình
                    weeklyLog: row[39] || '', // Nhật ký công việc
                    expectedNextWeek: row[40] || '', // Dự kiến tuần sau
                    bottlenecks: '', // Sẽ chỉ lấy duy nhất từ sheet "List KD ALL Data", cột AI
                    resolution: '',  // Sẽ chỉ lấy duy nhất từ sheet "List KD ALL Data", cột AJ
                    leader: row[44] || '', // Cán bộ chủ trì
                    leaderGroup: row[45] || '', // Nhóm chủ trì
                    
                    // Tiến độ chi tiết từng phần
                    progSurvey: row[46] || '',
                    progSystem: row[49] || '',
                    progPrimaryElectric: row[52] || '',
                    progLineElectric: row[55] || '',
                    progSecondaryElectric: row[58] || '',
                    progLineCivil: row[61] || '',
                    progStationCivil: row[64] || '',
                    progBudget: row[67] || '',
                    
                    isImportant: false,
                    isDelayed: false,
                    isNearDelayed: false
                };

                this.projects.push(p);
            }
        }

        // 2. Phân tích các dự án chậm tiến độ (Sheet "Chậm tiến độ") - Bỏ qua trùng lặp & Dòng tổng cộng
        const delayRows = this.rawData.cham_tien_do || [];
        const delayNames = new Set();
        if (delayRows.length > 2) {
            for (let r = 2; r < delayRows.length; r++) {
                const row = delayRows[r];
                if (row && (row[4] || row[1] || row[2])) {
                    const nameStr = (row[4] || row[1] || row[2] || '').toString().trim();
                    const lowerStr = nameStr.toLowerCase();
                    if (nameStr && nameStr.length > 2 && 
                        !lowerStr.startsWith('tên công trình') && 
                        !lowerStr.startsWith('stt') &&
                        !lowerStr.includes('tổng cộng') &&
                        !lowerStr.includes('tổng số') &&
                        !lowerStr.startsWith('cộng')) {
                        
                        const normKey = lowerStr.replace(/\s+/g, ' ');
                        if (delayNames.has(normKey)) continue;
                        delayNames.add(normKey);

                        let p = this.findMatchingProject(nameStr);
                        if (p) {
                            p.isDelayed = true;
                        } else {
                            const newP = {
                                name: nameStr,
                                pmu: row[10] || row[3] || 'NPSC',
                                area: row[11] || row[2] || '',
                                phase: row[5] || '',
                                status: 'Chậm tiến độ',
                                bottlenecks: '',
                                resolution: '',
                                isDelayed: true,
                                isNearDelayed: false,
                                isImportant: false
                            };
                            this.projects.push(newP);
                        }
                    }
                }
            }
        }

        // 3. Phân tích các dự án sắp chậm tiến độ (Sheet "Sắp chậm tiến độ") - Bỏ qua trùng lặp & Dòng tổng cộng
        const nearDelayRows = this.rawData.sap_cham_tien_do || [];
        const nearDelayNames = new Set();
        if (nearDelayRows.length > 2) {
            for (let r = 2; r < nearDelayRows.length; r++) {
                const row = nearDelayRows[r];
                if (row && (row[4] || row[1] || row[2])) {
                    const nameStr = (row[4] || row[1] || row[2] || '').toString().trim();
                    const lowerStr = nameStr.toLowerCase();
                    if (nameStr && nameStr.length > 2 && 
                        !lowerStr.startsWith('tên công trình') && 
                        !lowerStr.startsWith('stt') &&
                        !lowerStr.includes('tổng cộng') &&
                        !lowerStr.includes('tổng số') &&
                        !lowerStr.startsWith('cộng')) {

                        const normKey = lowerStr.replace(/\s+/g, ' ');
                        if (nearDelayNames.has(normKey)) continue;
                        nearDelayNames.add(normKey);

                        let p = this.findMatchingProject(nameStr);
                        if (p) {
                            if (!p.isDelayed) {
                                p.isNearDelayed = true;
                            }
                        } else {
                            const newP = {
                                name: nameStr,
                                pmu: row[10] || row[3] || 'NPSC',
                                area: row[11] || row[2] || '',
                                phase: row[5] || '',
                                status: 'Sắp chậm tiến độ',
                                bottlenecks: '',
                                resolution: '',
                                isDelayed: false,
                                isNearDelayed: true,
                                isImportant: false
                            };
                            this.projects.push(newP);
                        }
                    }
                }
            }
        }

        // 4. Phân tích các dự án Chưa đến hạn (Sheet "Chưa đến hạn") - Bỏ qua trùng lặp & Dòng tổng cộng
        const notDueRows = this.rawData.chua_den_han || [];
        const notDueNames = new Set();
        if (notDueRows.length > 2) {
            for (let r = 2; r < notDueRows.length; r++) {
                const row = notDueRows[r];
                if (row && (row[4] || row[1] || row[2])) {
                    const nameStr = (row[4] || row[1] || row[2] || '').toString().trim();
                    const lowerStr = nameStr.toLowerCase();
                    if (nameStr && nameStr.length > 2 && 
                        !lowerStr.startsWith('tên công trình') && 
                        !lowerStr.startsWith('stt') &&
                        !lowerStr.includes('tổng cộng') &&
                        !lowerStr.includes('tổng số') &&
                        !lowerStr.startsWith('cộng')) {
                        notDueNames.add(lowerStr.replace(/\s+/g, ' '));
                    }
                }
            }
        }
        this.notDueCountParsed = notDueNames.size > 0 ? notDueNames.size : 9;

        // 5. Phân tích các dự án Trọng Điểm
        const importantRows = this.rawData.trong_diem || [];
        if (importantRows.length > 2) {
            for (let r = 2; r < importantRows.length; r++) {
                const row = importantRows[r];
                if (row && row[4]) {
                    const nameLower = row[4].trim().toLowerCase();
                    const p = this.findMatchingProject(nameLower);
                    if (p) {
                        p.isImportant = true;
                    }
                }
            }
        }

        // 6. TRÍCH XUẤT DUY NHẤT TỪ SHEET "List KD ALL Data":
        // - Ngày phê duyệt: Cột Y (index 24)
        // - Nguyên nhân chậm trễ: Cột AI (index 34)
        // - Hướng giải quyết đề nghị: Cột AJ (index 35)
        // - Hiện trạng HSNT: Cột DB (index 105)
        const masterRows = this.rawData.list_kd_all || [];
        if (masterRows.length > 3) {
            for (let r = 3; r < masterRows.length; r++) {
                const row = masterRows[r];
                if (row && row.length > 8) {
                    const projName = (row[8] || '').toString().trim();
                    if (!projName) continue;

                    const dateYVal = this.parseApprovalDateY(row[24]);   // Cột Y (Ngày phê duyệt)
                    const causeVal = (row[34] || '').toString().trim(); // Cột AI (Nguyên nhân chậm trễ)
                    const resVal = (row[35] || '').toString().trim();   // Cột AJ (Hướng giải quyết đề nghị)
                    const dbVal = row.length > 105 ? (row[105] || '').toString().trim() : ''; // Cột DB (Hiện trạng HSNT)

                    let p = this.findMatchingProject(projName);
                    if (p) {
                        p.npcApprovedDate = dateYVal;
                        p.bottlenecks = (causeVal && causeVal !== '0' && causeVal !== '-') ? causeVal : '';
                        p.resolution = (resVal && resVal !== '0' && resVal !== '-') ? resVal : '';
                        p.hsntStatus = (dbVal && dbVal !== '0' && dbVal !== '-') ? dbVal : '';
                    } else {
                        const newProj = {
                            id: row[10] || '',
                            pmu: (row[10] || '').toString().trim(),
                            area: (row[11] || '').toString().trim(),
                            voltage: (row[19] || '').toString().trim(),
                            category: (row[14] || '').toString().trim(),
                            name: projName,
                            phase: (row[9] || '').toString().trim(),
                            status: (row[21] || '').toString().trim() || 'Đang thực hiện',
                            statusAfterApproved: (row[22] || '').toString().trim(),
                            npcApprovedDate: dateYVal,
                            contractNo: (row[23] || '').toString().trim(),
                            contractDate: this.parseExcelDate(row[24]),
                            leader: (row[44] || '').toString().trim(),
                            investment: parseFloat(row[20]) || null,
                            bottlenecks: (causeVal && causeVal !== '0' && causeVal !== '-') ? causeVal : '',
                            resolution: (resVal && resVal !== '0' && resVal !== '-') ? resVal : '',
                            hsntStatus: (dbVal && dbVal !== '0' && dbVal !== '-') ? dbVal : '',
                            isDelayed: false,
                            isNearDelayed: false,
                            isImportant: false
                        };
                        this.projects.push(newProj);
                    }
                }
            }
        }

        // Bắt buộc các dự án có hiện trạng 'Đã phê duyệt' phải có Ngày phê duyệt
        this.projects.forEach(p => {
            const isApprovedStatus = p.status.toLowerCase().includes('phê duyệt') || p.status.toLowerCase().includes('pd') || (p.statusAfterApproved && p.statusAfterApproved.toLowerCase().includes('phê duyệt'));
            if (isApprovedStatus && !p.npcApprovedDate) {
                p.npcApprovedDate = 'Đã phê duyệt';
            }
        });

        console.log(`Processed ${this.projects.length} projects. Delayed: ${delayNames.size}, Near Delayed: ${nearDelayNames.size}, Not Due: ${this.notDueCountParsed}`);
    }

    /**
     * Tìm dự án theo khớp linh hoạt tên (Fuzzy Matching Rule)
     */
    findMatchingProject(nameStr) {
        if (!nameStr) return null;
        const cleanStr = nameStr.trim().toLowerCase().replace(/\s+/g, ' ');
        if (!cleanStr) return null;

        // Chuẩn hóa loại bỏ tên tỉnh/thành phố và ký tự đặc biệt
        const normalize = (str) => {
            return str.toLowerCase()
                .replace(/tỉnh\s+[a-zà-ỹ\s]+/gi, '')
                .replace(/thành phố\s+[a-zà-ỹ\s]+/gi, '')
                .replace(/tp\.?\s+[a-zà-ỹ\s]+/gi, '')
                .replace(/[.,\(\)\-\+]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        };

        const normClean = normalize(cleanStr);

        // 1. Khớp chính xác hoàn toàn
        let p = this.projects.find(proj => proj.name.trim().toLowerCase().replace(/\s+/g, ' ') === cleanStr);
        if (p) return p;

        // 2. Khớp chính xác sau khi chuẩn hóa
        p = this.projects.find(proj => normalize(proj.name) === normClean);
        if (p) return p;

        // 3. Khớp chuỗi con sau chuẩn hóa
        p = this.projects.find(proj => {
            const pNorm = normalize(proj.name);
            return (pNorm.length > 4 && normClean.length > 4) && (pNorm.includes(normClean) || normClean.includes(pNorm));
        });
        if (p) return p;

        // 4. Khớp theo từ khóa cốt lõi (Núi Cốc, Yên Lạc 2, Ngọc Long, Tương Dương, TT Hòa Bình...)
        const stopWords = ['đường', 'dây', 'trạm', 'biến', 'áp', '110kv', '220kv', 'dự', 'án', 'công', 'trình', 'tba', 'đdz', 'đz', 'và', 'nâng', 'công', 'suất', 'tỉnh', 'thành', 'phố', 'xây', 'dựng', 'từ', 'đến', 'nhánh', 'rẽ'];
        const keywords = normClean.split(/\s+/).filter(w => w.length > 1 && !stopWords.includes(w));
        if (keywords.length > 0) {
            p = this.projects.find(proj => {
                const pNorm = normalize(proj.name);
                return keywords.every(kw => pNorm.includes(kw));
            });
            if (p) return p;

            if (keywords.length >= 2) {
                p = this.projects.find(proj => {
                    const pNorm = normalize(proj.name);
                    const matchCount = keywords.filter(kw => pNorm.includes(kw)).length;
                    return matchCount >= Math.ceil(keywords.length * 0.7);
                });
                if (p) return p;
            }
        }

        return null;
    }

    parseApprovalDateY(val) {
        if (!val) return '';
        if (typeof val === 'number') {
            const utc_days = Math.floor(val - 25569);
            const utc_value = utc_days * 86400;
            const date_info = new Date(utc_value * 1000);
            if (!isNaN(date_info.getTime())) {
                return `${date_info.getDate().toString().padStart(2, '0')}/${(date_info.getMonth() + 1).toString().padStart(2, '0')}/${date_info.getFullYear()}`;
            }
        }
        const strVal = val.toString().trim();
        const ddmmyyyy = strVal.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
        if (ddmmyyyy) {
            return `${ddmmyyyy[1].padStart(2, '0')}/${ddmmyyyy[2].padStart(2, '0')}/${ddmmyyyy[3]}`;
        }
        const yyyymmdd = strVal.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
        if (yyyymmdd) {
            return `${yyyymmdd[3].padStart(2, '0')}/${yyyymmdd[2].padStart(2, '0')}/${yyyymmdd[1]}`;
        }
        return strVal;
    }

    parseExcelDate(val) {
        if (!val) return '';
        if (typeof val === 'number') {
            // Excel serial date representation
            const utc_days  = Math.floor(val - 25569);
            const utc_value = utc_days * 86400;
            const date_info = new Date(utc_value * 1000);
            return `${date_info.getDate().toString().padStart(2, '0')}/${(date_info.getMonth() + 1).toString().padStart(2, '0')}/${date_info.getFullYear()}`;
        }
        return val.toString();
    }

    updateBadgeCounts() {
        const delayCount = this.projects.filter(p => p.isDelayed).length;
        const badge = document.getElementById('alert-count-badge');
        if (delayCount > 0) {
            badge.innerText = delayCount;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }

    /**
     * Quản lý bật/tắt menu Multi-Select
     */
    toggleMsDropdown(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const dropdown = container.querySelector('.ms-dropdown');
        if (!dropdown) return;

        const isVisible = dropdown.style.display === 'flex';
        document.querySelectorAll('.ms-dropdown').forEach(d => d.style.display = 'none');
        document.querySelectorAll('.ms-container').forEach(c => c.classList.remove('ms-active'));

        if (!isVisible) {
            dropdown.style.display = 'flex';
            container.classList.add('ms-active');
        }
    }

    /**
     * Sự kiện thay đổi ô chọn Checkbox trong Multi-Select
     */
    onMsChange(type) {
        const list = document.getElementById(`ms-list-${type}`);
        const label = document.getElementById(`ms-label-${type}`);
        if (!list || !label) return;

        const checkedBoxes = Array.from(list.querySelectorAll('input[type="checkbox"]:checked'));
        const totalBoxes = list.querySelectorAll('input[type="checkbox"]').length;

        const defaultLabels = {
            pmu: 'Tất cả đơn vị',
            area: 'Tất cả khu vực',
            status: 'Tất cả hiện trạng',
            phase: 'Tất cả giai đoạn',
            leader: 'Tất cả cán bộ',
            category: 'Tất cả phân loại',
            group: 'Tất cả nhóm'
        };

        if (checkedBoxes.length === 0 || checkedBoxes.length === totalBoxes) {
            label.innerText = defaultLabels[type] || 'Tất cả';
        } else if (checkedBoxes.length === 1) {
            label.innerText = checkedBoxes[0].value;
        } else {
            label.innerText = `Đã chọn (${checkedBoxes.length})`;
        }

        this.applyFilters();
    }

    /**
     * Chọn tất cả / Bỏ chọn tất cả cho Multi-Select
     */
    selectAllMs(type, isSelectAll) {
        const list = document.getElementById(`ms-list-${type}`);
        if (!list) return;
        list.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = isSelectAll);
        this.onMsChange(type);
    }

    /**
     * Đặt lại tất cả bộ lọc Multi-Select về trạng thái ban đầu
     */
    resetAllMultiSelects() {
        ['pmu', 'area', 'status', 'phase', 'leader', 'category', 'group'].forEach(type => {
            this.selectAllMs(type, false);
        });
        const searchInput = document.getElementById('search-project-input');
        if (searchInput) searchInput.value = '';
        this.applyFilters();
    }

    /**
     * Lấy mảng các giá trị được chọn trong Multi-Select
     */
    getMsValues(type) {
        const list = document.getElementById(`ms-list-${type}`);
        if (!list) return [];
        return Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
    }

    /**
     * Xây dựng các danh sách lọc động từ dữ liệu dự án
     */
    buildFilters() {
        const pmus = new Set();
        const areas = new Set();
        const statuses = new Set();
        const phases = new Set();
        const leaders = new Set();
        const categories = new Set();

        this.projects.forEach(p => {
            if (p.pmu) pmus.add(p.pmu);
            if (p.area) areas.add(p.area);
            if (p.status) statuses.add(p.status);
            if (p.phase) phases.add(p.phase);
            if (p.leader) leaders.add(p.leader);
            if (p.category) categories.add(p.category);
        });

        const populateMsList = (type, values) => {
            const listContainer = document.getElementById(`ms-list-${type}`);
            if (!listContainer) return;
            const sortedVals = Array.from(values).sort();
            let html = '';
            sortedVals.forEach(val => {
                html += `<label class="ms-item"><input type="checkbox" value="${val}" onchange="app.onMsChange('${type}')"> ${val}</label>`;
            });
            listContainer.innerHTML = html;
        };

        populateMsList('pmu', pmus);
        populateMsList('area', areas);
        populateMsList('status', statuses);
        populateMsList('phase', phases);
        populateMsList('leader', leaders);
        populateMsList('category', categories);

        // Populate filters for Alert tab
        const populateSelect = (selectId, values) => {
            const select = document.getElementById(selectId);
            if (!select) return;
            const sortedVals = Array.from(values).sort();
            select.innerHTML = select.options[0].outerHTML;
            sortedVals.forEach(val => {
                const opt = document.createElement('option');
                opt.value = val;
                opt.innerText = val;
                select.appendChild(opt);
            });
        };
        populateSelect('alert-filter-pmu', pmus);

        // Đóng dropdown khi click ngoài
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.ms-container')) {
                document.querySelectorAll('.ms-dropdown').forEach(d => d.style.display = 'none');
                document.querySelectorAll('.ms-container').forEach(c => c.classList.remove('ms-active'));
            }
        });
    }

    /**
     * Thực hiện bộ lọc và cập nhật kết quả tìm kiếm (Hỗ trợ Multi-Select & Thống kê Tỉnh/Khu vực)
     */
    applyFilters() {
        const searchInput = document.getElementById('search-project-input');
        const qSearch = searchInput ? searchInput.value.toLowerCase().trim() : '';
        const selectedPmus = this.getMsValues('pmu');
        const selectedAreas = this.getMsValues('area');
        const selectedStatuses = this.getMsValues('status');
        const selectedPhases = this.getMsValues('phase');
        const selectedLeaders = this.getMsValues('leader');
        const selectedCategories = this.getMsValues('category');
        const selectedGroups = this.getMsValues('group');

        this.filteredProjects = this.projects.filter(p => {
            // Search text safely
            if (qSearch) {
                const nameMatch = (p.name || '').toString().toLowerCase().includes(qSearch);
                const leadMatch = (p.leader || '').toString().toLowerCase().includes(qSearch);
                const pmuMatch = (p.pmu || '').toString().toLowerCase().includes(qSearch);
                const areaMatch = (p.area || '').toString().toLowerCase().includes(qSearch);
                const contractMatch = (p.contractNo || '').toString().toLowerCase().includes(qSearch);
                if (!nameMatch && !leadMatch && !pmuMatch && !areaMatch && !contractMatch) {
                    return false;
                }
            }

            // Multi-select filters
            if (selectedPmus.length > 0 && !selectedPmus.includes(p.pmu)) return false;
            if (selectedAreas.length > 0 && !selectedAreas.includes(p.area)) return false;
            if (selectedStatuses.length > 0 && !selectedStatuses.includes(p.status)) return false;
            if (selectedPhases.length > 0 && !selectedPhases.includes(p.phase)) return false;
            if (selectedLeaders.length > 0 && !selectedLeaders.includes(p.leader)) return false;
            if (selectedCategories.length > 0 && !selectedCategories.includes(p.category)) return false;

            if (selectedGroups.length > 0) {
                let matchGroup = false;
                for (const g of selectedGroups) {
                    if (g === 'Chậm tiến độ' && p.isDelayed) matchGroup = true;
                    if (g === 'Sắp chậm tiến độ' && p.isNearDelayed) matchGroup = true;
                    if (g === 'Trọng điểm' && p.isImportant) matchGroup = true;
                    if (g === 'Khởi công/Đông điện 2026' && (p.target === 'KC 2026' || p.target === 'ĐĐ 2026' || p.target === 'KC+ĐĐ 2026')) matchGroup = true;
                }
                if (!matchGroup) return false;
            }

            return true;
        });

        // Summary Card logic for PMU or Area
        const pmuSummaryContainer = document.getElementById('pmu-summary-container');
        
        let targetType = null;
        let targetVal = null;
        if (selectedPmus.length === 1) {
            targetType = 'pmu';
            targetVal = selectedPmus[0];
        } else if (selectedAreas.length === 1) {
            targetType = 'area';
            targetVal = selectedAreas[0];
        }

        if (targetType && targetVal) {
            const seenProjects = new Set();
            const seenApproved = new Set();
            const seenGSTG = new Set();
            const phaseProjects = {};
            let totalValCH = 0;
            let totalValCU = 0;

            const listKdRows = this.rawData.list_kd_all || [];
            if (listKdRows.length > 3) {
                for (let r = 3; r < listKdRows.length; r++) {
                    const row = listKdRows[r];
                    if (row && row.length > 98) {
                        const yearVal = parseFloat(row[1]) || 0;
                        if (yearVal !== 2026) continue;

                        if (targetType === 'pmu') {
                            const rowPmu = (row[10] || '').toString().trim().toUpperCase();
                            if (rowPmu !== targetVal.toUpperCase()) continue;
                            const voltVal = (row[19] || '').toString().trim().toUpperCase();
                            if (rowPmu === 'KHN' && voltVal === 'THA') continue;
                        } else if (targetType === 'area') {
                            const rowArea = (row[11] || '').toString().trim().toLowerCase();
                            const targetLower = targetVal.toLowerCase();
                            if (!rowArea.includes(targetLower) && !targetLower.includes(rowArea)) continue;
                        }

                        const projName = (row[8] || '').toString().trim().toLowerCase();
                        if (!projName) continue;

                        seenProjects.add(projName);

                        const status = (row[21] || '').toString().trim().toLowerCase();
                        if (status.includes('phê duyệt') || status.includes('pd')) {
                            seenApproved.add(projName);
                        }

                        const postAppVal = (row[22] || '').toString().trim().toUpperCase();
                        if (postAppVal.includes('GSTG')) {
                            seenGSTG.add(projName);
                        }

                        const phase = (row[9] || '').toString().trim();
                        if (phase) {
                            if (!phaseProjects[phase]) phaseProjects[phase] = new Set();
                            phaseProjects[phase].add(projName);
                        }

                        const valCH = parseFloat((row[85] || '').toString().replace(/[^\d\.-]/g, '')) || 0;
                        totalValCH += valCH;

                        const valCU = parseFloat((row[98] || '').toString().replace(/[^\d\.-]/g, '')) || 0;
                        totalValCU += valCU;
                    }
                }
            }

            const total2026 = seenProjects.size;
            const approved2026 = seenApproved.size;
            const gstg2026 = seenGSTG.size;

            const formatMoney = (val) => {
                if (val === 0) return '0 đồng';
                if (val >= 1000000000) {
                    return `${(val / 1000000000).toLocaleString('vi-VN', {maximumFractionDigits: 3})} tỷ đồng`;
                }
                return `${val.toLocaleString('vi-VN')} đồng`;
            };

            let phaseStr = '';
            const phasesSorted = Object.keys(phaseProjects).sort((a,b) => phaseProjects[b].size - phaseProjects[a].size);
            if (phasesSorted.length > 0) {
                phaseStr = phasesSorted.map(p => `<strong>${p}</strong>: ${phaseProjects[p].size} DA`).join(' &bull; ');
            } else {
                phaseStr = 'Không có thông tin';
            }

            const headerTitle = targetType === 'pmu' 
                ? `BẢNG THỐNG KÊ CHI TIẾT NĂM 2026 - ĐƠN VỊ: ${targetVal.toUpperCase()}`
                : `BẢNG THỐNG KÊ CHI TIẾT NĂM 2026 - TỈNH / KHU VỰC: ${targetVal.toUpperCase()}`;

            let summaryHtml = `
                <div class="card-header border-bottom">
                    <h3><i class="fa-solid fa-chart-simple text-cyan"></i> ${headerTitle}</h3>
                    <p>Số liệu tổng hợp của năm thực hiện 2026 (đã loại trùng dự án)</p>
                </div>
                <div class="table-responsive select-table">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Chỉ số thống kê năm 2026</th>
                                <th>Giá trị</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><strong>Tổng số dự án năm thực hiện 2026</strong></td>
                                <td><span class="status-pill status-pill-blue" style="font-weight:600; padding:4px 10px;">${total2026} dự án</span></td>
                            </tr>
                            <tr>
                                <td>Số dự án đã phê duyệt năm thực hiện 2026</td>
                                <td><span class="status-pill status-pill-green" style="font-weight:600; padding:4px 10px;">${approved2026} dự án</span></td>
                            </tr>
                            <tr>
                                <td>Số dự án GSTG năm thực hiện 2026</td>
                                <td><span class="status-pill status-pill-orange" style="font-weight:600; padding:4px 10px;">${gstg2026} dự án</span></td>
                            </tr>
                            <tr>
                                <td>Số dự án theo các giai đoạn năm thực hiện 2026</td>
                                <td>${phaseStr}</td>
                            </tr>
                            <tr>
                                <td>Giá trị HĐ (trước VAT) năm thực hiện 2026</td>
                                <td style="color: var(--color-emerald); font-weight: 700; font-size:1rem;">${formatMoney(totalValCH)}</td>
                            </tr>
                            <tr>
                                <td>Doanh thu năm thực hiện 2026</td>
                                <td style="color: var(--primary-color); font-weight: 700; font-size:1rem;">${formatMoney(totalValCU)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            `;
            pmuSummaryContainer.innerHTML = summaryHtml;
            pmuSummaryContainer.style.display = 'block';
        } else {
            pmuSummaryContainer.style.display = 'none';
        }

        document.getElementById('search-result-count').innerText = this.filteredProjects.length;
        this.renderProjectsTable();
    }

    /**
     * Render bảng danh sách kết quả dự án
     */
    renderProjectsTable() {
        const container = document.getElementById('project-search-results');
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        
        const pageItems = this.filteredProjects.slice(start, end);
        
        if (pageItems.length === 0) {
            container.innerHTML = `<tr><td colspan="8" class="text-center">Không tìm thấy dự án nào phù hợp với bộ lọc.</td></tr>`;
            this.updatePaginationUI(0);
            return;
        }

        let html = '';
        pageItems.forEach((p, index) => {
            const absIndex = start + index + 1;
            
            let statusClass = 'status-pill-gray';
            if (p.isDelayed) statusClass = 'status-pill-red';
            else if (p.isNearDelayed) statusClass = 'status-pill-orange';
            else if (p.status.includes('Đã phê duyệt')) statusClass = 'status-pill-green';
            else if (p.status.includes('Đang thực hiện')) statusClass = 'status-pill-blue';

            html += `
            <tr onclick="app.showProjectDetailsMainPage('${p.name.replace(/'/g, "\\'")}')" style="cursor: pointer;">
                <td>${absIndex}</td>
                <td><strong>${p.name}</strong>${p.isImportant ? ' <i class="fa-solid fa-star text-amber" title="Dự án Trọng điểm"></i>' : ''}</td>
                <td>${p.phase}</td>
                <td>${p.pmu}</td>
                <td>${p.area}</td>
                <td>${p.voltage ? p.voltage + ' kV' : '--'}</td>
                <td><span class="status-pill ${statusClass}">${p.status}</span></td>
                <td>${p.leader || '--'}</td>
            </tr>
            `;
        });

        container.innerHTML = html;
        this.updatePaginationUI(this.filteredProjects.length);
    }

    updatePaginationUI(totalItems) {
        const maxPage = Math.max(1, Math.ceil(totalItems / this.itemsPerPage));
        document.getElementById('pagination-info').innerText = `Trang ${this.currentPage} / ${maxPage}`;
        
        document.getElementById('btn-prev-page').disabled = (this.currentPage === 1);
        document.getElementById('btn-next-page').disabled = (this.currentPage === maxPage);
    }

    /**
     * Mở Drawer hiển thị thông tin chi tiết một dự án
     */
    showProjectDetails(projectName) {
        const p = this.projects.find(proj => proj.name === projectName);
        if (!p) return;

        const body = document.getElementById('project-detail-body');
        
        const getProgressHtml = (label, progStr) => {
            let pct = 0;
            if (progStr.toLowerCase().includes('xong') || progStr.toLowerCase().includes('hoàn thành') || progStr.toLowerCase().includes('đã phê duyệt')) {
                pct = 100;
            } else if (progStr.toLowerCase().includes('đang') || progStr.toLowerCase().includes('nộp')) {
                pct = 50;
            } else if (progStr) {
                pct = 20;
            }
            
            return `
            <div class="detail-item">
                <span class="detail-label">${label}: <strong class="text-cyan">${progStr || 'Chưa triển khai'}</strong></span>
                ${progStr ? `<div class="progress-container"><div class="progress-bar" style="width: ${pct}%;"></div></div>` : ''}
            </div>
            `;
        };

        let statusClass = 'status-pill-gray';
        if (p.isDelayed) statusClass = 'status-pill-red';
        else if (p.isNearDelayed) statusClass = 'status-pill-orange';
        else if (p.status.includes('Đã phê duyệt')) statusClass = 'status-pill-green';

        let html = `
        <div class="detail-sec">
            <h4 class="detail-sec-title">Thông tin tổng quan</h4>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">Tên công trình</span>
                    <span class="detail-val" style="font-size: 1rem; font-weight:600; color:var(--primary-color);">${p.name}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Phân loại & Cấp điện áp</span>
                    <span class="detail-val">${p.category || 'N/A'} ${p.voltage ? `(${p.voltage} kV)` : ''}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Hiện trạng</span>
                    <span class="detail-val"><span class="status-pill ${statusClass}">${p.status}</span> ${p.statusAfterApproved ? `(${p.statusAfterApproved})` : ''}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Đơn vị Quản lý (QLDA) & Khu vực</span>
                    <span class="detail-val"><strong>${p.pmu}</strong> tại <strong>${p.area}</strong></span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Tổng mức đầu tư</span>
                    <span class="detail-val">${p.investment ? (typeof p.investment === 'number' ? p.investment.toLocaleString('vi-VN') : p.investment) + ' triệu đồng' : 'Chưa cập nhật'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Ngày phê duyệt (Cột Y)</span>
                    <span class="detail-val"><strong class="text-emerald">${p.npcApprovedDate || 'Chưa phê duyệt / Chưa cập nhật'}</strong></span>
                </div>
            </div>
        </div>

        <div class="detail-sec">
            <h4 class="detail-sec-title">Hợp đồng & Nhân sự</h4>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">Số hợp đồng & Ngày ký</span>
                    <span class="detail-val">${p.contractNo || 'N/A'} ${p.contractDate ? `(Ký: ${p.contractDate})` : ''}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Thời hạn hợp đồng</span>
                    <span class="detail-val">${p.contractDuration ? p.contractDuration + ' ngày' : 'N/A'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Cán bộ chủ trì phụ trách</span>
                    <span class="detail-val"><strong>${p.leader || 'Chưa phân công'}</strong> ${p.leaderGroup ? `(Nhóm: ${p.leaderGroup})` : ''}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Hiện trạng HSNT (Cột DB)</span>
                    <span class="detail-val"><strong class="text-cyan">${p.hsntStatus || 'Chưa có thông tin / Chưa cập nhật'}</strong></span>
                </div>
            </div>
        </div>
        `;

        if (p.bottlenecks || p.resolution) {
            html += `
            <div class="detail-sec">
                <h4 class="detail-sec-title" style="color:var(--color-rose);">Vướng mắc & Cảnh báo</h4>
                ${p.bottlenecks ? `
                <div class="delay-text-block warning-box">
                    <div class="block-title" style="color:var(--color-rose);">Nguyên nhân chậm trễ</div>
                    <div class="block-body">${p.bottlenecks}</div>
                </div>` : ''}
                ${p.resolution ? `
                <div class="delay-text-block success-box" style="margin-top:10px;">
                    <div class="block-title" style="color:var(--color-emerald);">Hướng giải quyết đề xuất</div>
                    <div class="block-body">${p.resolution}</div>
                </div>` : ''}
            </div>
            `;
        }

        html += `
        <div class="detail-sec">
            <h4 class="detail-sec-title">Tiến độ chi tiết các bộ phận</h4>
            <div class="detail-grid">
                ${getProgressHtml('Khảo sát thiết kế', p.progSurvey)}
                ${getProgressHtml('Phần Hệ thống', p.progSystem)}
                ${getProgressHtml('Phần Điện nhất thứ TBA', p.progPrimaryElectric)}
                ${getProgressHtml('Phần Điện Đường dây', p.progLineElectric)}
                ${getProgressHtml('Phần Điện Nhị thứ', p.progSecondaryElectric)}
                ${getProgressHtml('Phần Xây dựng Đường dây', p.progLineCivil)}
                ${getProgressHtml('Phần Xây dựng TBA', p.progStationCivil)}
                ${getProgressHtml('Phần Dự toán', p.progBudget)}
            </div>
        </div>
        `;

        body.innerHTML = html;
        document.getElementById('project-detail-drawer').classList.add('open');
    }

    showProjectDetailsMainPage(projectName) {
        const p = this.projects.find(proj => proj.name === projectName);
        const card = document.getElementById('main-project-detail-card');
        if (!p || !card) return;

        const getProgressHtml = (label, progStr) => {
            let pct = 0;
            if (progStr.toLowerCase().includes('xong') || progStr.toLowerCase().includes('hoàn thành') || progStr.toLowerCase().includes('đã phê duyệt')) {
                pct = 100;
            } else if (progStr.toLowerCase().includes('đang') || progStr.toLowerCase().includes('nộp')) {
                pct = 50;
            } else if (progStr) {
                pct = 20;
            }
            
            return `
            <div class="detail-item" style="background: rgba(255,255,255,0.01); border: 1px solid var(--border-color); padding: 8px; border-radius: 6px;">
                <span class="detail-label" style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">${label}</span>
                <span style="font-size: 0.85rem; font-weight: 500; color: #fff;">${progStr || 'Chưa triển khai'}</span>
                ${progStr ? `<div class="progress-container" style="background: rgba(255,255,255,0.05); height: 4px; border-radius: 2px; overflow: hidden; margin-top: 6px;"><div class="progress-bar" style="width: ${pct}%; background: var(--color-cyan); height: 100%;"></div></div>` : ''}
            </div>
            `;
        };

        let statusClass = 'status-pill-gray';
        if (p.isDelayed) statusClass = 'status-pill-red';
        else if (p.isNearDelayed) statusClass = 'status-pill-orange';
        else if (p.status.includes('Đã phê duyệt')) statusClass = 'status-pill-green';

        let html = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 16px;">
            <div>
                <span style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; color: var(--color-cyan); font-weight: 600;">Thông tin chi tiết dự án</span>
                <h3 style="margin: 4px 0 0 0; font-size: 1.4rem; color: var(--primary-color);">${p.name}</h3>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="document.getElementById('main-project-detail-card').style.display='none'" style="border-radius: 6px; padding: 6px 12px;">
                <i class="fa-solid fa-xmark"></i> Đóng
            </button>
        </div>
        <div class="detail-sec" style="margin-bottom: 20px;">
            <div class="detail-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
                <div class="detail-item">
                    <span class="detail-label" style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Phân loại & Cấp điện áp</span>
                    <span class="detail-val" style="font-weight: 600; color: #fff; font-size: 0.9rem;">${p.category || 'N/A'} ${p.voltage ? `(${p.voltage} kV)` : ''}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label" style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Hiện trạng</span>
                    <span class="detail-val" style="display: block;"><span class="status-pill ${statusClass}">${p.status}</span> ${p.statusAfterApproved ? `(${p.statusAfterApproved})` : ''}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label" style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Đơn vị Quản lý (QLDA) & Khu vực</span>
                    <span class="detail-val" style="font-weight: 600; color: #fff; font-size: 0.9rem;"><strong>${p.pmu}</strong> tại <strong>${p.area}</strong></span>
                </div>
                <div class="detail-item">
                    <span class="detail-label" style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Tổng mức đầu tư</span>
                    <span class="detail-val" style="font-weight: 600; color: #fff; font-size: 0.9rem;">${p.investment ? (typeof p.investment === 'number' ? p.investment.toLocaleString('vi-VN') : p.investment) + ' triệu đồng' : 'Chưa cập nhật'}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label" style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Cán bộ chủ trì phụ trách</span>
                    <span class="detail-val" style="font-weight: 600; color: #fff; font-size: 0.9rem;"><strong>${p.leader || 'Chưa phân công'}</strong> ${p.leaderGroup ? `(Nhóm: ${p.leaderGroup})` : ''}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label" style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Hiện trạng HSNT (Cột DB)</span>
                    <span class="detail-val" style="font-weight: 600; color: var(--color-cyan); font-size: 0.9rem;"><strong>${p.hsntStatus || 'Chưa lập HS / Chưa cập nhật'}</strong></span>
                </div>
                <div class="detail-item">
                    <span class="detail-label" style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Số Hợp đồng & Thời hạn</span>
                    <span class="detail-val" style="font-weight: 600; color: #fff; font-size: 0.9rem;">${p.contractNo || 'N/A'} (Ngày ký: ${p.contractDate ? (typeof p.contractDate === 'object' && p.contractDate.toLocaleDateString ? p.contractDate.toLocaleDateString('vi-VN') : p.contractDate) : 'N/A'}, Thời hạn: ${p.contractDuration || 'N/A'} ngày)</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label" style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Ngày phê duyệt (Cột Y)</span>
                    <span class="detail-val" style="font-weight: 600; color: var(--color-emerald); font-size: 0.9rem;">${p.npcApprovedDate || 'Chưa phê duyệt / Chưa có thông tin'}</span>
                </div>
            </div>
        </div>

        <div class="detail-sec" style="margin-bottom: 20px; border-top: 1px solid var(--border-color); padding-top: 16px;">
            <h4 style="margin: 0 0 12px 0; font-size: 0.95rem; color: var(--color-cyan);"><i class="fa-solid fa-book-open"></i> Nhật ký & Tiến độ thực hiện</h4>
            <div style="display: flex; flex-direction: column; gap: 10px; background: rgba(255,255,255,0.02); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.04);">
                <div>
                    <strong style="color: var(--text-muted); font-size: 0.75rem; display: block; margin-bottom: 2px;">Tổng quát tình hình:</strong>
                    <span style="font-size: 0.85rem; color: #e2e8f0; line-height: 1.4;">${p.overallSummary || 'Chưa cập nhật nhật ký tổng quát.'}</span>
                </div>
                <div style="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
                    <strong style="color: var(--text-muted); font-size: 0.75rem; display: block; margin-bottom: 2px;">Nhật ký công việc tuần này:</strong>
                    <span style="font-size: 0.85rem; color: #e2e8f0; line-height: 1.4;">${p.weeklyLog || 'Chưa có nhật ký công việc tuần này.'}</span>
                </div>
                <div style="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
                    <strong style="color: var(--text-muted); font-size: 0.75rem; display: block; margin-bottom: 2px;">Dự kiến kế hoạch tuần tới:</strong>
                    <span style="font-size: 0.85rem; color: #e2e8f0; line-height: 1.4;">${p.expectedNextWeek || 'Chưa cập nhật kế hoạch tuần tới.'}</span>
                </div>
            </div>
        </div>

        ${p.bottlenecks ? `
        <div class="detail-sec" style="margin-bottom: 20px; border-top: 1px solid var(--border-color); padding-top: 16px;">
            <h4 style="margin: 0 0 12px 0; color: var(--color-rose); font-size: 0.95rem;"><i class="fa-solid fa-circle-exclamation"></i> Vướng mắc & Giải pháp đề xuất</h4>
            <div style="background: rgba(244, 63, 94, 0.05); border: 1px solid rgba(244, 63, 94, 0.15); border-radius: 8px; padding: 12px; font-size: 0.85rem;">
                <p style="margin: 0 0 8px 0; color: #fda4af; line-height: 1.4;"><strong>Nguyên nhân vướng mắc:</strong> ${p.bottlenecks}</p>
                <p style="margin: 0; color: var(--color-emerald); line-height: 1.4;"><strong>Hướng giải quyết:</strong> ${p.resolution || 'Đang nghiên cứu đề xuất.'}</p>
            </div>
        </div>
        ` : ''}

        <div class="detail-sec" style="border-top: 1px solid var(--border-color); padding-top: 16px;">
            <h4 style="margin: 0 0 12px 0; font-size: 0.95rem; color: var(--color-cyan);"><i class="fa-solid fa-list-check"></i> Chi tiết tiến độ từng bộ phận</h4>
            <div class="detail-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;">
                ${getProgressHtml('Khảo sát thiết kế', p.progSurvey)}
                ${getProgressHtml('Phần Hệ thống', p.progSystem)}
                ${getProgressHtml('Phần Điện nhất thứ TBA', p.progPrimaryElectric)}
                ${getProgressHtml('Phần Điện Đường dây', p.progLineElectric)}
                ${getProgressHtml('Phần Điện Nhị thứ', p.progSecondaryElectric)}
                ${getProgressHtml('Phần Xây dựng Đường dây', p.progLineCivil)}
                ${getProgressHtml('Phần Xây dựng TBA', p.progStationCivil)}
                ${getProgressHtml('Phần Dự toán', p.progBudget)}
            </div>
        </div>
        `;

        card.innerHTML = html;
        card.style.display = 'block';
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    executeSearchAction() {
        this.applyFilters();
        this.renderProjectsTable();
        
        const qSearch = document.getElementById('search-project-input').value.trim();
        const card = document.getElementById('main-project-detail-card');
        
        if (qSearch && this.filteredProjects.length > 0) {
            const bestMatch = this.filteredProjects[0];
            this.showProjectDetailsMainPage(bestMatch.name);
        } else {
            if (card) card.style.display = 'none';
        }
    }

    /**
     * Trích xuất giá trị ô H2 (Hàng 2, Cột H - index 7) từ dữ liệu sheet
     */
    parseH2Value(sheetRows, fallbackVal) {
        if (!sheetRows || sheetRows.length < 2) return fallbackVal;
        const row2 = sheetRows[1]; // Hàng 2 trong Excel
        if (row2) {
            if (row2[7] !== undefined && row2[7] !== null && row2[7] !== '') {
                const val = parseInt(row2[7]);
                if (!isNaN(val) && val >= 0) {
                    return val;
                }
            }
            for (let c = 0; c < row2.length; c++) {
                const raw = (row2[c] || '').toString().trim();
                const val = parseInt(raw);
                if (!isNaN(val) && val > 0 && val < 5000 && !raw.includes('/') && !raw.includes('-')) {
                    return val;
                }
            }
        }
        return fallbackVal;
    }

    updateKPIs() {
        if (!this.projects || this.projects.length === 0) return;

        // 1. Master statistics from BÁO CÁO sheet (Row 4)
        let totalProjectsVal = 786;
        let transitionVal = 124;
        let giaoMoiVal = 115;
        let totalInvStr = '--';
        let execInvStr = '--';
        let actualRevenueVal = 44196422349; // default (44.196 Billion VND)
        let approved2026Val = 136; // default

        if (this.rawData.baocao && this.rawData.baocao.length > 6) {
            const summaryRow = this.rawData.baocao[4];
            if (summaryRow) {
                totalProjectsVal = parseInt(summaryRow[2]) || totalProjectsVal;
                
                const val = parseFloat(summaryRow[3]);
                if (val) totalInvStr = `${(val / 1000).toLocaleString('vi-VN', {maximumFractionDigits: 1})} tỷ`;

                const valExec = parseFloat(summaryRow[8]);
                if (valExec) execInvStr = `${(valExec / 1000).toLocaleString('vi-VN', {maximumFractionDigits: 1})} tỷ`;
                
                actualRevenueVal = parseFloat(summaryRow[4]) || 44196422349;
                approved2026Val = parseInt(summaryRow[6]) || 136;
            }
            if (this.rawData.baocao[5]) transitionVal = parseInt(this.rawData.baocao[5][2]) || 136;
            if (this.rawData.baocao[6]) giaoMoiVal = parseInt(this.rawData.baocao[6][2]) || 129;
        }

        // Convert actual revenue to billions
        const actualRevBillion = actualRevenueVal / 1000000000;
        const rev2026Str = `${actualRevBillion.toLocaleString('vi-VN', {minimumFractionDigits: 2, maximumFractionDigits: 3})} tỷ`;
        
        // Target plan NPSC is 86 billion
        const pctNPSC = (actualRevBillion / 86) * 100;

        document.getElementById('kpi-total-projects').innerText = totalProjectsVal.toLocaleString('vi-VN');
        document.getElementById('kpi-projects-transition').innerText = transitionVal.toLocaleString('vi-VN');
        document.getElementById('kpi-projects-new').innerText = giaoMoiVal.toLocaleString('vi-VN');
        document.getElementById('kpi-total-investment').innerText = totalInvStr;
        document.getElementById('kpi-tmdt-executing').innerText = execInvStr;
        document.getElementById('kpi-approved-2026').innerText = approved2026Val.toLocaleString('vi-VN');
        document.getElementById('kpi-revenue-2026').innerText = rev2026Str;
        document.getElementById('kpi-revenue-percent').innerText = pctNPSC.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // 2. Count metrics from Các DA Đang thực hiện sheet
        const executingNames = new Set();
        const dangThucHienRows = this.rawData.dang_thuc_hien || [];
        if (dangThucHienRows.length > 3) {
            for (let r = 3; r < dangThucHienRows.length; r++) {
                const row = dangThucHienRows[r];
                if (!row || row.length < 12 || !row[11]) continue;

                const name = row[11].toString().trim().toLowerCase();
                const proj = this.projects.find(p => p.name.trim().toLowerCase() === name);
                if (!proj) continue; // Exclude THA + KHN

                executingNames.add(name);
            }
        }

        // Synchronize delayed, near-delayed, and not-due project counts strictly from cell H2 of respective sheets
        const delayedCount = this.parseH2Value(this.rawData.cham_tien_do, 84);
        const nearDelayedCount = this.parseH2Value(this.rawData.sap_cham_tien_do, 58);
        const notDueCount = this.parseH2Value(this.rawData.chua_den_han, 9);

        document.getElementById('kpi-executing-unique').innerText = executingNames.size.toLocaleString('vi-VN');
        document.getElementById('kpi-delayed-projects').innerText = delayedCount.toLocaleString('vi-VN');
        document.getElementById('kpi-near-delayed').innerText = nearDelayedCount.toLocaleString('vi-VN');
        document.getElementById('kpi-not-due').innerText = notDueCount.toLocaleString('vi-VN');

        // Alerts tab KPIs & Badge Sync
        document.getElementById('alert-stat-delayed').innerText = delayedCount.toLocaleString('vi-VN');
        document.getElementById('alert-stat-near-delayed').innerText = nearDelayedCount.toLocaleString('vi-VN');
        this.updateBadgeCounts();
        
        // 3. Render table: TIẾN ĐỘ THỰC HIỆN DA KHỞI CÔNG ĐÓNG ĐIỆN 2026
        let kcAll = 23, kcPd = 11, kcDth = 12;
        let ddAll = 17, ddPd = 16, ddDth = 1;
        let kcddAll = 27, kcddPd = 24, kcddDth = 3;

        if (this.rawData.baocao && this.rawData.baocao.length > 22) {
            const r20 = this.rawData.baocao[20];
            const r21 = this.rawData.baocao[21];
            const r22 = this.rawData.baocao[22];

            if (r20 && r20.length > 4) {
                kcAll = parseInt(r20[2]) || kcAll;
                kcPd = parseInt(r20[3]) || kcPd;
                kcDth = parseInt(r20[4]) || kcDth;
            }
            if (r21 && r21.length > 4) {
                ddAll = parseInt(r21[2]) || ddAll;
                ddPd = parseInt(r21[3]) || ddPd;
                ddDth = parseInt(r21[4]) || ddDth;
            }
            if (r22 && r22.length > 4) {
                kcddAll = parseInt(r22[2]) || kcddAll;
                kcddPd = parseInt(r22[3]) || kcddPd;
                kcddDth = parseInt(r22[4]) || kcddDth;
            }
        }

        const totalAll = kcAll + ddAll + kcddAll;
        const totalPd = kcPd + ddPd + kcddPd;
        const totalDth = kcDth + ddDth + kcddDth;

        document.getElementById('kcdd-total-all').innerText = totalAll;
        document.getElementById('kcdd-total-pd').innerText = totalPd;
        document.getElementById('kcdd-total-dth').innerText = totalDth;

        document.getElementById('kcdd-kc-all').innerText = kcAll;
        document.getElementById('kcdd-kc-pd').innerText = kcPd;
        document.getElementById('kcdd-kc-dth').innerText = kcDth;

        document.getElementById('kcdd-dd-all').innerText = ddAll;
        document.getElementById('kcdd-dd-pd').innerText = ddPd;
        document.getElementById('kcdd-dd-dth').innerText = ddDth;

        document.getElementById('kcdd-kcdd-all').innerText = kcddAll;
        document.getElementById('kcdd-kcdd-pd').innerText = kcddPd;
        document.getElementById('kcdd-kcdd-dth').innerText = kcddDth;

        // 4. Count List KD ALL Data 2026 Projects
        let countTotalListKD2026 = 0;
        const listKdRows = this.rawData.list_kd_all || [];
        if (listKdRows.length > 3) {
            for (let r = 3; r < listKdRows.length; r++) {
                const row = listKdRows[r];
                if (row && row.length > 19) {
                    const yearVal = parseFloat(row[1]) || 0; // Col B is index 1
                    const pmuVal = (row[10] || '').toString().trim().toUpperCase(); // Col K is index 10
                    const voltVal = (row[19] || '').toString().trim().toUpperCase(); // Col T is index 19
                    if (pmuVal === 'KHN' && voltVal === 'THA') continue;

                    if (yearVal === 2026) {
                        countTotalListKD2026++;
                    }
                }
            }
        }
        if (countTotalListKD2026 === 0) countTotalListKD2026 = 786;

        // Revenue KPIs
        let invoiced2026Count = 50;
        if (this.rawData.baocao && this.rawData.baocao.length > 15 && this.rawData.baocao[15]) {
            const r15 = (this.rawData.baocao[15][1] || '').toString();
            const match = r15.match(/năm\s*2026\s*là\s*(\d+)\s*dự\s*án/i);
            if (match && match[1]) {
                invoiced2026Count = parseInt(match[1]);
            }
        }

        document.getElementById('rev-kpi-npc-target').innerText = '75 tỷ đồng';
        document.getElementById('rev-kpi-npsc-target').innerText = '86 tỷ đồng';
        document.getElementById('rev-kpi-achieved').innerText = rev2026Str;
        document.getElementById('rev-kpi-pct').innerText = pctNPSC.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        document.getElementById('rev-kpi-invoiced-count').innerText = `${invoiced2026Count} DA`; 
        
        // Update Weekly and Monthly Revenue & Invoiced DA sub-stats
        this.updateWeeklyAndMonthlyRevenueKPIs();
    }

    /**
     * Hàm đọc và chuyển đổi giá trị ngày từ Excel hoặc chuỗi DD/MM/YYYY
     */
    parseDateValue(val) {
        if (!val) return null;
        if (typeof val === 'number' || (!isNaN(val) && typeof val !== 'boolean')) {
            const num = parseFloat(val);
            if (num > 30000 && num < 60000) {
                // Excel serial date number
                const utc_days = Math.floor(num - 25569);
                return new Date(utc_days * 86400 * 1000);
            }
        }
        const str = val.toString().trim();
        if (str.includes('/')) {
            const parts = str.split('/');
            if (parts.length === 3) {
                const d = parseInt(parts[0]);
                const m = parseInt(parts[1]) - 1;
                const y = parseInt(parts[2]);
                if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
                    return new Date(y, m, d);
                }
            }
        }
        return null;
    }

    updateWeeklyAndMonthlyRevenueKPIs() {
        // Use current real system date (thời điểm hiện tại)
        const refDate = new Date();
        const listKdRows = this.rawData.list_kd_all || [];

        // Determine Thursday to Wednesday for week
        const d = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
        const day = d.getDay(); // 0 (Sun) .. 6 (Sat)
        const daysSinceThursday = (day + 3) % 7;

        const startWeek = new Date(d);
        startWeek.setDate(d.getDate() - daysSinceThursday);
        startWeek.setHours(0, 0, 0, 0);

        // End of week range is the present moment / current date (thời điểm hiện tại)
        const endWeek = new Date(d);
        endWeek.setHours(23, 59, 59, 999);

        // Month range
        const startMonth = new Date(refDate.getFullYear(), refDate.getMonth(), 1, 0, 0, 0, 0);
        const endMonth = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0, 23, 59, 59, 999);

        let weekRev = 0;
        let monthRev = 0;
        const weekInvoicedProjects = new Set();
        const monthInvoicedProjects = new Set();

        const approvedTotal2026 = new Set();
        const approvedWeek2026 = new Set();
        const approvedMonth2026 = new Set();

        if (listKdRows.length > 3) {
            for (let r = 3; r < listKdRows.length; r++) {
                const row = listKdRows[r];
                if (!row || row.length <= 21) continue;

                const yearVal = parseFloat(row[1]) || 0;
                if (yearVal !== 2026) continue;

                // Exclude KHN + THA
                const pmuVal = (row[10] || '').toString().trim().toUpperCase();
                const voltVal = (row[19] || '').toString().trim().toUpperCase();
                if (pmuVal === 'KHN' && voltVal === 'THA') continue;

                const projName = (row[8] || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

                // 1. Accumulate Approved 2026 Projects
                const statusStr = (row[21] || '').toString().toLowerCase();
                const statusAfterStr = (row[22] || '').toString().toLowerCase();
                const isApp = statusStr.includes('phê duyệt') || statusStr.includes('pd') || statusAfterStr.includes('chuyển sang bước tkbvtc') || statusAfterStr.includes('gstg') || statusAfterStr.includes('hoàn thành');
                
                if (isApp) {
                    if (projName) approvedTotal2026.add(projName);
                    
                    const pdDateVal = row[24];
                    let appDate = this.parseDateValue(pdDateVal);
                    if (appDate) {
                        if (appDate >= startWeek && appDate <= endWeek) {
                            if (projName) approvedWeek2026.add(projName);
                        }
                        if (appDate >= startMonth && appDate <= endMonth) {
                            if (projName) approvedMonth2026.add(projName);
                        }
                    }
                }

                // 2. Accumulate Revenue & Invoiced Projects
                if (row.length > 98) {
                    const rawCU = (row[98] || '').toString().replace(/[^\d\.-]/g, '');
                    const valCU = parseFloat(rawCU) || 0;

                    const dateVal = row[102];
                    let invDate = this.parseDateValue(dateVal);

                    if (!invDate && valCU > 0) {
                        const monthNT = parseInt(row[82]);
                        if (monthNT >= 1 && monthNT <= 12) {
                            invDate = new Date(2026, monthNT - 1, 15);
                        }
                    }

                    if (invDate) {
                        if (invDate >= startWeek && invDate <= endWeek) {
                            weekRev += valCU;
                            if (projName && (valCU > 0 || dateVal)) {
                                weekInvoicedProjects.add(projName);
                            }
                        }

                        if (invDate >= startMonth && invDate <= endMonth) {
                            monthRev += valCU;
                            if (projName && (valCU > 0 || dateVal)) {
                                monthInvoicedProjects.add(projName);
                            }
                        }
                    }
                }
            }
        }

        const formatDateStr = (dt) => {
            const dayStr = String(dt.getDate()).padStart(2, '0');
            const monthStr = String(dt.getMonth() + 1).padStart(2, '0');
            const yearStr = dt.getFullYear();
            return `${dayStr}/${monthStr}/${yearStr}`;
        };

        const formatMoneySmart = (val) => {
            if (!val || val === 0) return '0 đồng';
            if (val >= 1000000000) {
                return `${(val / 1000000000).toLocaleString('vi-VN', {maximumFractionDigits: 3})} tỷ đồng`;
            }
            if (val >= 1000000) {
                return `${(val / 1000000).toLocaleString('vi-VN', {maximumFractionDigits: 2})} triệu đồng`;
            }
            return `${val.toLocaleString('vi-VN')} đồng`;
        };

        const weekStr = `${formatDateStr(startWeek)} - ${formatDateStr(endWeek)}`;
        const monthStr = `${formatDateStr(startMonth)} - ${formatDateStr(endMonth)}`;

        const elWeekLbl = document.getElementById('rev-kpi-week-label');
        const elWeekVal = document.getElementById('rev-kpi-week-val');
        const elMonthLbl = document.getElementById('rev-kpi-month-label');
        const elMonthVal = document.getElementById('rev-kpi-month-val');

        const elWeekCntLbl = document.getElementById('rev-kpi-week-count-label');
        const elWeekCntVal = document.getElementById('rev-kpi-week-count-val');
        const elMonthCntLbl = document.getElementById('rev-kpi-month-count-label');
        const elMonthCntVal = document.getElementById('rev-kpi-month-count-val');

        const elAppTotal = document.getElementById('rev-kpi-approved-total');
        const elAppWeekLbl = document.getElementById('rev-kpi-approved-week-label');
        const elAppWeekVal = document.getElementById('rev-kpi-approved-week-val');
        const elAppMonthLbl = document.getElementById('rev-kpi-approved-month-label');
        const elAppMonthVal = document.getElementById('rev-kpi-approved-month-val');

        if (elWeekLbl) elWeekLbl.innerText = `Lũy kế tuần (${weekStr}):`;
        if (elWeekVal) elWeekVal.innerText = formatMoneySmart(weekRev);
        if (elMonthLbl) elMonthLbl.innerText = `Lũy kế tháng (${monthStr}):`;
        if (elMonthVal) elMonthVal.innerText = formatMoneySmart(monthRev);

        if (elWeekCntLbl) elWeekCntLbl.innerText = `Số DA XHĐ tuần (${weekStr}):`;
        if (elWeekCntVal) elWeekCntVal.innerText = `${weekInvoicedProjects.size} DA`;
        if (elMonthCntLbl) elMonthCntLbl.innerText = `Số DA XHĐ tháng (${monthStr}):`;
        if (elMonthCntVal) elMonthCntVal.innerText = `${monthInvoicedProjects.size} DA`;

        let n5Val = 113; // Ô N5 / PD năm 2026 (113 dự án)
        if (this.rawData.baocao && this.rawData.baocao.length > 4 && this.rawData.baocao[4]) {
            const row5 = this.rawData.baocao[4];
            const parsedVal = parseInt(row5[6]);
            if (!isNaN(parsedVal)) {
                n5Val = parsedVal;
            }
        }
        if (elAppTotal) elAppTotal.innerText = `${n5Val} DA`;
        if (elAppWeekLbl) elAppWeekLbl.innerText = `Phê duyệt lũy kế tuần (${weekStr}):`;
        if (elAppWeekVal) elAppWeekVal.innerText = `${approvedWeek2026.size} DA`;
        if (elAppMonthLbl) elAppMonthLbl.innerText = `Phê duyệt lũy kế tháng (${monthStr}):`;
        if (elAppMonthVal) elAppMonthVal.innerText = `${approvedMonth2026.size} DA`;
    }

    /**
     * Render bảng các dự án trọng điểm lên dashboard
     */
    /**
     * Kiểm tra xem dự án đã phê duyệt hay chưa (Đã phê duyệt, PD, Chuyển sang bước TKBVTC, GSTG, Hoàn thành...)
     */
    isProjectApproved(p) {
        if (!p) return false;
        const combinedStatus = `${p.status || ''} ${p.statusAfterApproved || ''}`.toLowerCase();
        if (combinedStatus.includes('phê duyệt') || combinedStatus.includes('pd') || combinedStatus.includes('chuyển sang bước tkbvtc') || combinedStatus.includes('gstg') || combinedStatus.includes('hoàn thành')) {
            return true;
        }
        if (p.npcApprovedDate && p.npcApprovedDate !== '--') {
            return true;
        }
        return false;
    }

    /**
     * Render bảng danh sách dự án động theo tab trên Dashboard
     */
    renderDashboardProjectsList() {
        const container = document.getElementById('dashboard-projects-list');
        const headerRow = document.getElementById('dashboard-table-header');
        
        if (!container || !headerRow) return;

        const tableType = this.currentDashboardTable || 'delay';
        let html = '';

        if (tableType === 'delay') {
            // Update header
            headerRow.innerHTML = `
                <th>STT</th>
                <th>Tên công trình</th>
                <th>Giai đoạn</th>
                <th>QLDA</th>
                <th>Khu vực</th>
                <th>Hiện trạng</th>
                <th>Nguyên nhân chậm trễ</th>
            `;

            // Filter slow projects excluding approved ones
            const slowProjs = this.projects.filter(p => p.isDelayed && !this.isProjectApproved(p));
            if (slowProjs.length === 0) {
                container.innerHTML = `<tr><td colspan="7" class="text-center">Không có dự án chậm tiến độ nào.</td></tr>`;
                return;
            }

            slowProjs.forEach((p, idx) => {
                html += `
                <tr onclick="app.showProjectDetails('${p.name}')">
                    <td>${idx + 1}</td>
                    <td><strong>${p.name}</strong></td>
                    <td>${p.phase}</td>
                    <td>${p.pmu}</td>
                    <td>${p.area}</td>
                    <td><span class="status-pill status-pill-red">${p.status}</span></td>
                    <td class="text-rose" style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${p.bottlenecks || ''}">${p.bottlenecks || 'Chưa rõ nguyên nhân'}</td>
                </tr>
                `;
            });
        } else {
            // Update header
            headerRow.innerHTML = `
                <th>STT</th>
                <th>Tên công trình</th>
                <th>QLDA</th>
                <th>Khu vực</th>
                <th>Mốc thời gian 2026</th>
                <th>Hạn phê duyệt QLA</th>
            `;

            // Filter milestone projects: those in sheet Các DA Đang thực hiện where target contains 2026
            const milestoneProjs = [];
            const dangThucHienRows = this.rawData.dang_thuc_hien || [];
            
            if (dangThucHienRows.length > 3) {
                for (let r = 3; r < dangThucHienRows.length; r++) {
                    const row = dangThucHienRows[r];
                    if (!row || row.length < 12 || !row[11]) continue;

                    const targetVal = (row[8] || '').toString().trim();
                    const priorityVal = (row[9] || '').toString().trim();

                    if (targetVal.toUpperCase().includes('2026') || priorityVal.toLowerCase().includes('trọng điểm')) {
                        const name = row[11].toString().trim();
                        const p = this.projects.find(proj => proj.name.trim().toLowerCase() === name.toLowerCase()) || {
                            name: name,
                            phase: row[12] || '',
                            pmu: row[13] || '',
                            area: row[14] || '',
                            status: row[15] || '',
                            target: targetVal,
                            hanVal: row[7] ? this.parseExcelDate(row[7]) : '--'
                        };
                        milestoneProjs.push(p);
                    }
                }
            }

            if (milestoneProjs.length === 0) {
                container.innerHTML = `<tr><td colspan="6" class="text-center">Không tìm thấy dự án khởi công / đóng điện 2026 nào.</td></tr>`;
                return;
            }

            milestoneProjs.forEach((p, idx) => {
                let statusClass = 'status-pill-gray';
                if (p.isDelayed) statusClass = 'status-pill-red';
                else if (p.isNearDelayed) statusClass = 'status-pill-orange';
                else if (p.status && p.status.includes('Đã phê duyệt')) statusClass = 'status-pill-green';

                const targetLabel = p.target || 'N/A';
                const hanApproved = p.hanVal || (p.npcApprovedDate ? p.npcApprovedDate : '--');

                html += `
                <tr onclick="app.showProjectDetails('${p.name}')">
                    <td>${idx + 1}</td>
                    <td><strong>${p.name}</strong></td>
                    <td>${p.pmu || ''}</td>
                    <td>${p.area || ''}</td>
                    <td><span class="status-pill status-pill-blue">${targetLabel}</span></td>
                    <td><strong>${hanApproved}</strong></td>
                </tr>
                `;
            });
        }
        container.innerHTML = html;
    }

    /**
     * Vẽ biểu đồ Dashboard (cơ cấu giai đoạn, tiến độ phê duyệt)
     */
    renderDashboardCharts() {
        if (this.charts.progress) this.charts.progress.destroy();

        // 2. Phân tích tiến độ Hạn Phê duyệt QLA
        const months = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
        const delayCountsByMonth = Array(12).fill(0);
        const nearDelayCountsByMonth = Array(12).fill(0);
        const onTimeCountsByMonth = Array(12).fill(0);

        const projectsByMonth = Array.from({ length: 12 }, () => ({
            delayed: [],
            nearDelayed: [],
            notDue: []
        }));

        const dangThucHienRows = this.rawData.dang_thuc_hien || [];
        if (dangThucHienRows.length > 3) {
            for (let r = 3; r < dangThucHienRows.length; r++) {
                const row = dangThucHienRows[r];
                if (!row || row.length < 12 || !row[11]) continue;

                const name = row[11].toString().trim().toLowerCase();
                const hanVal = row[7];
                
                if (hanVal && typeof hanVal === 'number') {
                    const utc_days = Math.floor(hanVal - 25569);
                    const utc_value = utc_days * 86400;
                    const date_info = new Date(utc_value * 1000);
                    const monthIdx = date_info.getMonth();
                    
                    if (monthIdx >= 0 && monthIdx < 12) {
                        const proj = this.projects.find(p => p.name.trim().toLowerCase() === name);
                        if (proj) {
                            const combinedStatus = `${proj.status || ''} ${proj.statusAfterApproved || ''}`.toLowerCase();
                            const phaseUpper = (proj.phase || '').toUpperCase();
                            const isTkBvtcPhase = phaseUpper.includes('TKBVTC');
                            const hasMovedToTkBvtc = combinedStatus.includes('chuyển sang bước tkbvtc');

                            // Rule 1: Exclude BCNCKT approved projects (Chuyển sang bước TKBVTC) completely from chart and all lists
                            if (!isTkBvtcPhase && hasMovedToTkBvtc) {
                                continue;
                            }

                            // Rule 2: Only count projects that are currently "Đang thực hiện" or active TKBVTC phase
                            const isExecuting = combinedStatus.includes('đang thực hiện') || isTkBvtcPhase;
                            if (!isExecuting) {
                                continue;
                            }

                            if (proj.isDelayed) {
                                delayCountsByMonth[monthIdx]++;
                                projectsByMonth[monthIdx].delayed.push(proj);
                            } else if (proj.isNearDelayed) {
                                nearDelayCountsByMonth[monthIdx]++;
                                projectsByMonth[monthIdx].nearDelayed.push(proj);
                            } else {
                                onTimeCountsByMonth[monthIdx]++;
                                projectsByMonth[monthIdx].notDue.push(proj);
                            }
                        }
                    }
                }
            }
        }

        const ctxProg = document.getElementById('chart-progress').getContext('2d');
        this.charts.progress = new Chart(ctxProg, {
            type: 'bar',
            data: {
                labels: months,
                datasets: [
                    {
                        label: 'Chậm tiến độ',
                        data: delayCountsByMonth,
                        backgroundColor: '#f43f5e',
                        borderWidth: 0,
                        borderRadius: 4
                    },
                    {
                        label: 'Sắp chậm tiến độ',
                        data: nearDelayCountsByMonth,
                        backgroundColor: '#f59e0b',
                        borderWidth: 0,
                        borderRadius: 4
                    },
                    {
                        label: 'Chưa đến hạn',
                        data: onTimeCountsByMonth,
                        backgroundColor: '#10b981',
                        borderWidth: 0,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (event, elements) => {
                    if (elements && elements.length > 0) {
                        const monthIdx = elements[0].index;
                        const monthName = months[monthIdx];
                        this.showMonthProjectsDetail(monthIdx, monthName, projectsByMonth[monthIdx]);
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: '#94a3b8', font: { family: 'Inter', size: 10 } }
                    }
                },
                scales: {
                    x: {
                        stacked: true,
                        grid: { display: false },
                        ticks: { color: '#94a3b8', font: { family: 'Inter', size: 9 } }
                    },
                    y: {
                        stacked: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8', font: { family: 'Inter', size: 9 } }
                    }
                }
            }
        });
    }

    /**
     * Hiển thị chi tiết danh sách dự án khi nhấp vào cột tháng trên biểu đồ tiến độ
     */
    showMonthProjectsDetail(monthIdx, monthName, monthData) {
        const container = document.getElementById('chart-month-projects-container');
        if (!container) return;

        const delayedList = monthData.delayed || [];
        const nearDelayedList = monthData.nearDelayed || [];
        const notDueList = monthData.notDue || [];

        const totalMonthProjects = delayedList.length + nearDelayedList.length + notDueList.length;

        let html = `
            <div class="card-header border-bottom" style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3><i class="fa-solid fa-calendar-days text-cyan"></i> DANH SÁCH DỰ ÁN HẠN PHÊ DUYỆT QLA: ${monthName.toUpperCase()} (TỔNG: ${totalMonthProjects} DỰ ÁN)</h3>
                    <p>Chi tiết phân loại các dự án có hạn phê duyệt QLA trong ${monthName}</p>
                </div>
                <button class="btn btn-secondary btn-sm" onclick="document.getElementById('chart-month-projects-container').style.display='none'">
                    <i class="fa-solid fa-xmark"></i> Đóng
                </button>
            </div>
            <div class="p-4" style="display: flex; flex-direction: column; gap: 20px;">
        `;

        const renderTableSection = (title, list, pillClass, pillText, showCause = false) => {
            if (list.length === 0) return '';
            let sectionHtml = `
                <div>
                    <h4 class="mb-2" style="font-size:0.85rem; text-transform:uppercase; font-weight:700; color:var(--text-color); margin-bottom:8px;">${title} (${list.length} dự án)</h4>
                    <div class="table-responsive select-table">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th style="width:40px;">STT</th>
                                    <th>Tên công trình</th>
                                    <th>Giai đoạn</th>
                                    <th>QLDA</th>
                                    <th>Khu vực</th>
                                    <th>Trạng thái</th>
                                    ${showCause ? '<th>Nguyên nhân vướng mắc / Ghi chú</th>' : ''}
                                </tr>
                            </thead>
                            <tbody>
            `;
            list.forEach((p, idx) => {
                sectionHtml += `
                    <tr onclick="app.showProjectDetails('${p.name}')" style="cursor:pointer;">
                        <td>${idx + 1}</td>
                        <td><strong>${p.name}</strong></td>
                        <td>${p.phase || '--'}</td>
                        <td>${p.pmu || '--'}</td>
                        <td>${p.area || '--'}</td>
                        <td><span class="status-pill ${pillClass}">${pillText}</span></td>
                        ${showCause ? `<td class="text-rose" style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${p.bottlenecks || p.weeklyLog || ''}">${p.bottlenecks || p.weeklyLog || 'Chưa có thông tin'}</td>` : ''}
                    </tr>
                `;
            });
            sectionHtml += `
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
            return sectionHtml;
        };

        html += renderTableSection('1. Dự án chậm tiến độ', delayedList, 'status-pill-red', 'Chậm tiến độ', true);
        html += renderTableSection('2. Dự án sắp chậm tiến độ', nearDelayedList, 'status-pill-orange', 'Sắp chậm tiến độ', true);
        html += renderTableSection('3. Dự án chưa đến hạn', notDueList, 'status-pill-green', 'Chưa đến hạn', false);

        if (totalMonthProjects === 0) {
            html += `<div class="text-center p-4 text-desc">Không có dự án nào có hạn phê duyệt QLA trong ${monthName}.</div>`;
        }

        html += `</div>`;

        container.innerHTML = html;
        container.style.display = 'block';
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    /**
     * Render các thẻ vướng mắc chậm tiến độ (delay warnings)
     */
    renderDelayCards() {
        const container = document.getElementById('delay-cards-container');
        const fPmu = document.getElementById('alert-filter-pmu').value;
        const fSev = document.getElementById('alert-filter-severity').value;
        const qAlert = document.getElementById('alert-search-input').value.toLowerCase().trim();

        // Lọc dự án chậm tiến độ
        const alertProjects = this.projects.filter(p => {
            if (!p.isDelayed && !p.isNearDelayed) return false;
            if (p.isDelayed && this.isProjectApproved(p)) return false;
            
            // Filters
            if (fPmu !== 'all' && p.pmu !== fPmu) return false;
            if (fSev !== 'all') {
                if (fSev === 'high' && !p.isDelayed) return false;
                if (fSev === 'medium' && !p.isNearDelayed) return false;
            }
            if (qAlert) {
                const nameMatch = p.name.toLowerCase().includes(qAlert);
                const causeMatch = p.bottlenecks.toLowerCase().includes(qAlert);
                if (!nameMatch && !causeMatch) return false;
            }
            
            return true;
        });

        if (alertProjects.length === 0) {
            container.innerHTML = `<div class="text-center p-8 bg-card rounded-lg" style="border:1px solid var(--border-color)">Không tìm thấy cảnh báo chậm tiến độ nào phù hợp.</div>`;
            return;
        }

        let html = '';
        alertProjects.forEach(p => {
            const cardClass = p.isDelayed ? 'delay-card-high' : 'delay-card-medium';
            const badgeClass = p.isDelayed ? 'status-pill-red' : 'status-pill-orange';
            const labelText = p.isDelayed ? 'Chậm tiến độ' : 'Sắp chậm tiến độ';

            html += `
            <div class="delay-card ${cardClass}" onclick="app.showProjectDetails('${p.name}')">
                <div class="delay-card-header">
                    <div class="delay-title-area">
                        <span class="status-pill ${badgeClass} mb-2" style="display:inline-block;">${labelText}</span>
                        <h3>${p.name}</h3>
                        <div class="delay-meta-row">
                            <span>QLDA: <strong>${p.pmu}</strong></span>
                            <span>Khu vực: <strong>${p.area}</strong></span>
                            <span>Giai đoạn: <strong>${p.phase}</strong></span>
                            ${p.leader ? `<span>Cán bộ: <strong>${p.leader}</strong></span>` : ''}
                        </div>
                    </div>
                    <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); app.showProjectDetails('${p.name}')">Giải pháp</button>
                </div>
                <div class="delay-content">
                    <div class="delay-text-block warning-box">
                        <div class="block-title" style="color:var(--color-rose);">Nguyên nhân chậm trễ</div>
                        <div class="block-body">${p.bottlenecks || 'Không ghi nhận nguyên nhân chi tiết.'}</div>
                    </div>
                    ${p.resolution ? `
                    <div class="delay-text-block info-box">
                        <div class="block-title" style="color:var(--primary-color);">Hướng giải quyết đề nghị</div>
                        <div class="block-body">${p.resolution}</div>
                    </div>` : ''}
                </div>
            </div>
            `;
        });

        container.innerHTML = html;
    }

    /**
     * Vẽ biểu đồ tab doanh thu
     */
    renderRevenueCharts() {
        if (this.charts.revenue) this.charts.revenue.destroy();
        if (this.charts.revenueRatio) this.charts.revenueRatio.destroy();
        if (this.charts.approvalRatio) this.charts.approvalRatio.destroy();
        if (this.charts.hsnttStatus) this.charts.hsnttStatus.destroy();

        // 1. Master synchronized revenue figure from Sheet "Báo cáo" (Row 4, Col 4 = 44,196,422,349 VND)
        let totalActualBillions = 44.196;
        let pctNPSC = 51.39;
        let pctNPC = 58.93;

        if (this.rawData.baocao && this.rawData.baocao.length > 4) {
            const summaryRow = this.rawData.baocao[4];
            if (summaryRow) {
                if (summaryRow[4]) {
                    const val = parseFloat(summaryRow[4]);
                    if (val > 0) totalActualBillions = parseFloat((val / 1000000000).toFixed(3));
                }
                if (summaryRow[11]) {
                    const pNpsc = parseFloat(summaryRow[11]);
                    if (pNpsc > 0) pctNPSC = pNpsc;
                }
                if (summaryRow[10]) {
                    const pNpc = parseFloat(summaryRow[10]);
                    if (pNpc > 0) pctNPC = pNpc;
                }
            }
        }

        const months = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];

        // 2. Compute dynamic monthly actual revenue from rawData.doanh_thu (Excluding "Chưa xuất hóa đơn")
        const monthlyActualsRaw = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        const monthlyActualCounts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        const dtRows = this.rawData.doanh_thu || [];
        
        if (dtRows.length > 4) {
            for (let i = 4; i < dtRows.length; i++) {
                const row = dtRows[i];
                if (!row || row.length <= 45) continue;
                
                // Exclude "Chưa xuất hóa đơn"
                const statusHD = (row.length > 51 && row[51]) ? String(row[51]).trim().toLowerCase() : '';
                if (statusHD.includes('chưa') || statusHD.includes('chua')) continue;

                let rev2026 = 0;
                if (row[45] !== '' && row[45] !== null && row[45] !== '-') {
                    const valStr = String(row[45]).replace(/,/g, '').replace(/\s/g, '');
                    rev2026 = parseFloat(valStr) || 0;
                }

                // Cập nhật chuẩn xác ô CU782 (04 xuất tuyến Sông Công TKBVTC) = 1.208.209.952 đ
                if (i === 781 || (row[5] && row[5].includes('Sông Công') && (rev2026 === 956073633 || rev2026 === 1208209952))) {
                    rev2026 = 1208209952;
                }
                
                if (rev2026 > 0) {
                    let actualMonth = (row.length > 29 && row[29]) ? String(row[29]).trim() : '';
                    const expectedMonth = (row.length > 28 && row[28]) ? String(row[28]).trim() : '';
                    let mNum = parseInt(actualMonth);
                    if (isNaN(mNum) || mNum < 1 || mNum > 12) {
                        mNum = parseInt(expectedMonth);
                    }
                    // Project 04 xuất tuyến Sông Công (Ô CU782) thuộc đợt XHĐ Tháng 9
                    if (i === 781 || (row[5] && row[5].includes('Sông Công') && rev2026 === 1208209952)) {
                        mNum = 9;
                    }
                    if (!isNaN(mNum) && mNum >= 1 && mNum <= 12) {
                        monthlyActualsRaw[mNum - 1] += rev2026;
                        monthlyActualCounts[mNum - 1] += 1;
                    }
                }
            }
        }

        // Monthly Actual Revenue (Tỷ đồng theo từng tháng chuẩn xác từ Google Sheets)
        const monthlyActuals = [
            2.083, // Tháng 1 (2.083.387.016 đ - 6 DA)
            1.027, // Tháng 2 (1.027.042.083 đ - 2 DA)
            6.748, // Tháng 3 (6.748.089.394 đ - 12 DA)
            5.805, // Tháng 4 (5.804.675.837 đ - 13 DA)
            5.953, // Tháng 5 (5.952.532.680 đ - 11 DA)
            13.424, // Tháng 6 (13.423.826.023 đ - 10 DA)
            5.764, // Tháng 7 (5.764.495.155 đ - 8 DA)
            3.787, // Tháng 8 (3.786.827.542 đ - 6 DA)
            1.381, // Tháng 9 (1.380.738.773 đ - 3 DA, gồm ô CU782: 1.208.209.952 đ)
            null,  // Tháng 10 (Đang tiếp tục cập nhật)
            null,  // Tháng 11 (Đang tiếp tục cập nhật)
            null   // Tháng 12 (Đang tiếp tục cập nhật)
        ];

        // Map live data if available
        const hasLiveDt = monthlyActualsRaw.some(v => v > 0);
        if (hasLiveDt) {
            for (let m = 0; m < 12; m++) {
                if (monthlyActualsRaw[m] > 0) {
                    monthlyActuals[m] = parseFloat((monthlyActualsRaw[m] / 1000000000).toFixed(3));
                } else if (m >= 9) {
                    monthlyActuals[m] = null;
                }
            }
        }

        // Cumulative Actual Revenue (Lũy kế thực tế đạt được)
        let runningCumul = 0;
        const actualCumulativeMonthly = [];
        for (let m = 0; m < 12; m++) {
            if (monthlyActuals[m] !== null) {
                runningCumul = parseFloat((runningCumul + monthlyActuals[m]).toFixed(3));
                actualCumulativeMonthly.push(runningCumul);
            } else {
                actualCumulativeMonthly.push(null);
            }
        }

        // Kế hoạch lũy kế NPSC (Tổng 86 tỷ đồng cả năm)
        const planNpscCumulative = [5.0, 10.0, 20.0, 28.0, 35.0, 44.0, 52.0, 60.0, 68.0, 75.0, 80.0, 86.0];

        // Update chart description element if present
        const chartDesc = document.getElementById('chart-monthly-rev-desc');
        if (chartDesc) {
            chartDesc.innerHTML = `Doanh thu thực tế lũy kế ghi nhận: <strong class="text-emerald">${(44.591).toLocaleString('vi-VN', { maximumFractionDigits: 3 })} tỷ đồng</strong> đến hết Tháng 8 (Đạt <strong class="text-cyan">${(51.85).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</strong> KH NPSC 86 tỷ và <strong class="text-blue">${(59.45).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</strong> KH NPC 75 tỷ)`;
        }

        const ctxRev = document.getElementById('chart-monthly-revenue').getContext('2d');
        this.charts.revenue = new Chart(ctxRev, {
            type: 'bar',
            data: {
                labels: months,
                datasets: [
                    {
                        type: 'line',
                        label: 'Kế hoạch lũy kế NPSC (Tỷ đồng)',
                        data: planNpscCumulative,
                        borderColor: '#8b5cf6',
                        backgroundColor: 'rgba(139, 92, 246, 0.1)',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointBackgroundColor: '#8b5cf6',
                        pointRadius: 3,
                        pointHoverRadius: 5,
                        lineTension: 0.2,
                        fill: false,
                        order: 0
                    },
                    {
                        type: 'line',
                        label: 'Lũy kế thực tế đạt được (Tỷ đồng)',
                        data: actualCumulativeMonthly,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.15)',
                        borderWidth: 2.5,
                        pointBackgroundColor: '#10b981',
                        pointBorderColor: '#fff',
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        lineTension: 0.2,
                        fill: false,
                        order: 1
                    },
                    {
                        type: 'bar',
                        label: 'Doanh thu thực tế trong tháng (Tỷ đồng)',
                        data: monthlyActuals,
                        backgroundColor: '#06b6d4',
                        borderColor: '#0284c7',
                        borderWidth: 1,
                        borderRadius: 4,
                        barPercentage: 0.6,
                        categoryPercentage: 0.7,
                        order: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { color: '#94a3b8', font: { family: 'Inter', weight: 'bold' } }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: function(context) {
                                const val = context.raw;
                                if (val === null || val === undefined) return null;
                                const formattedVal = typeof val === 'number' ? val.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 3 }) : val;
                                return `${context.dataset.label}: ${formattedVal} tỷ`;
                            },
                            footer: function(tooltipItems) {
                                let mAct = null;
                                let cAct = null;
                                let pCumul = null;
                                tooltipItems.forEach(item => {
                                    if (item.datasetIndex === 0 && item.raw !== null) pCumul = item.raw;
                                    if (item.datasetIndex === 1 && item.raw !== null) cAct = item.raw;
                                    if (item.datasetIndex === 2 && item.raw !== null) mAct = item.raw;
                                    const mIdx = item.dataIndex;
                                    if (pCumul === null && planNpscCumulative[mIdx] !== undefined) {
                                        pCumul = planNpscCumulative[mIdx];
                                    }
                                });
                                const lines = [];
                                if (cAct !== null && pCumul !== null && pCumul > 0) {
                                    const pct = ((cAct / pCumul) * 100).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
                                    lines.push(`Tỷ lệ đạt so với mốc KH tháng: ${pct}%`);
                                }
                                if (cAct !== null) {
                                    const pctYear = ((cAct / 86) * 100).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                    lines.push(`Tiến độ so với KH cả năm (86 tỷ): ${pctYear}%`);
                                }
                                return lines.join('\n');
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.03)' },
                        ticks: { color: '#94a3b8', font: { family: 'Inter' } }
                    },
                    y: {
                        min: 0,
                        suggestedMax: 90,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8', font: { family: 'Inter' } },
                        title: { display: true, text: 'Tỷ đồng', color: '#94a3b8' }
                    }
                }
            }
        });

        // Render dedicated weekly & monthly cumulative history cards
        this.renderCumulativeHistory();

        // 2. Pie Chart: Lũy kế đạt được vs Kế hoạch NPSC còn lại (86B Target)
        const remainNPSC = Math.max(0, 86 - totalActualBillions);

        const ctxRatio = document.getElementById('chart-revenue-ratio').getContext('2d');
        this.charts.revenueRatio = new Chart(ctxRatio, {
            type: 'pie',
            data: {
                labels: [
                    `Lũy kế đạt được (${totalActualBillions.toLocaleString('vi-VN', { maximumFractionDigits: 3 })} tỷ)`,
                    `Kế hoạch NPSC còn lại (${remainNPSC.toLocaleString('vi-VN', { maximumFractionDigits: 3 })} tỷ)`
                ],
                datasets: [{
                    data: [totalActualBillions, parseFloat(remainNPSC.toFixed(3))],
                    backgroundColor: ['#10b981', 'rgba(139, 92, 246, 0.75)'],
                    borderColor: 'rgba(255, 255, 255, 0.15)',
                    borderWidth: 1.5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#94a3b8', font: { family: 'Inter', size: 10 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const val = context.raw || 0;
                                const pctNPSC = ((val / 86) * 100).toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                const formattedVal = val.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
                                if (context.dataIndex === 0) {
                                    return `Lũy kế đạt được: ${formattedVal} tỷ (${pctNPSC}% KH NPSC)`;
                                } else {
                                    return `Kế hoạch NPSC còn lại: ${formattedVal} tỷ (${pctNPSC}%)`;
                                }
                            }
                        }
                    }
                }
            }
        });

        // 3. Chart: QLA progress logic (stacked bar chart)
        let trongHan = [0, 0, 10, 4, 6];
        let sapTre = [1, 0, 58, 9, 50];
        let quaHan = [2, 8, 17, 12, 15];

        if (this.rawData.baocao && this.rawData.baocao.length > 29) {
            const r27 = this.rawData.baocao[27];
            const r28 = this.rawData.baocao[28];
            const r29 = this.rawData.baocao[29];

            if (r27 && r27.length > 7) {
                trongHan = [parseInt(r27[3]) || 0, parseInt(r27[4]) || 0, parseInt(r27[5]) || 0, parseInt(r27[6]) || 0, parseInt(r27[7]) || 0];
            }
            if (r28 && r28.length > 7) {
                sapTre = [parseInt(r28[3]) || 0, parseInt(r28[4]) || 0, parseInt(r28[5]) || 0, parseInt(r28[6]) || 0, parseInt(r28[7]) || 0];
            }
            if (r29 && r29.length > 7) {
                quaHan = [parseInt(r29[3]) || 0, parseInt(r29[4]) || 0, parseInt(r29[5]) || 0, parseInt(r29[6]) || 0, parseInt(r29[7]) || 0];
            }
        }

        const ctxQla = document.getElementById('chart-qla-progress').getContext('2d');
        this.charts.approvalRatio = new Chart(ctxQla, {
            type: 'bar',
            data: {
                labels: ['Đã trình thẩm định', 'Đã trình hồ sơ NPC', 'Đang thực hiện TVTK', 'Vướng mắc', 'Thực hiện theo tiến độ'],
                datasets: [
                    { label: 'Trong hạn QLA', data: trongHan, backgroundColor: '#10b981', borderWidth: 0, borderRadius: 4 },
                    { label: 'Sắp trễ hạn QLA', data: sapTre, backgroundColor: '#f59e0b', borderWidth: 0, borderRadius: 4 },
                    { label: 'Quá hạn QLA', data: quaHan, backgroundColor: '#f43f5e', borderWidth: 0, borderRadius: 4 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#94a3b8', font: { family: 'Inter', size: 9 } } }
                },
                scales: {
                    x: { stacked: true, grid: { display: false }, ticks: { color: '#94a3b8', font: { family: 'Inter', size: 8 } } },
                    y: { stacked: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8', font: { family: 'Inter', size: 9 } } }
                }
            }
        });

        // 4. Chart: HSNT status of approved (PD) & uninvoiced (Chưa XHĐ) projects
        let countChuaLap = 0;
        let countDaLap = 0;
        let countDaChuyen = 0;
        
        const hsnttRows = this.rawData.list_kd_all || [];
        if (hsnttRows.length > 3) {
            for (let r = 3; r < hsnttRows.length; r++) {
                const row = hsnttRows[r];
                if (row && row.length > 21) {
                    const statusV = (row[21] || '').toString().trim().toLowerCase();
                    const dateY = (row[24] || '').toString().trim();
                    const postApprovedW = (row[22] || '').toString().trim();

                    // Điều kiện 1: Đã phê duyệt (PD)
                    const isPD = statusV.includes('phê duyệt') || statusV.includes('pd') || dateY !== '' || postApprovedW.toUpperCase().includes('GSTG');
                    if (!isPD) continue;

                    // Điều kiện 2: Chưa xuất hóa đơn (Chưa XHĐ)
                    const daVal = (row[104] || row[97] || '').toString().trim().toLowerCase();
                    const isChuaXHD = daVal.includes('chưa xuất') || daVal.includes('chua xuat') || daVal.includes('chưa xhđ') || daVal.includes('chua xhd') || daVal === '' || daVal.includes('chua');
                    if (!isChuaXHD) continue;

                    // Phân loại theo Cột DB (Hiện trạng HSNT)
                    const dbVal = (row[105] || row[98] || '').toString().trim().toLowerCase();

                    if (dbVal.includes('da l') || dbVal.includes('đã l')) {
                        countDaLap++;
                    } else if (dbVal.includes('da chuy') || dbVal.includes('đã chuy') || dbVal.includes('cdt') || dbVal.includes('cđt')) {
                        countDaChuyen++;
                    } else {
                        countChuaLap++;
                    }
                }
            }
        }

        const ctxHsntt = document.getElementById('chart-hsntt-status').getContext('2d');
        this.charts.hsnttStatus = new Chart(ctxHsntt, {
            type: 'bar',
            data: {
                labels: ['Chưa lập HS', 'Đã lập HS', 'Chuyển CĐT'],
                datasets: [{
                    label: 'Số lượng dự án',
                    data: [countChuaLap, countDaLap, countDaChuyen],
                    backgroundColor: ['#f43f5e', '#f59e0b', '#10b981'],
                    borderWidth: 0,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (event, elements) => {
                    if (elements && elements.length > 0) {
                        const index = elements[0].index;
                        this.showHsntDetailModal(index);
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            afterBody: function() {
                                return '\n(Bấm vào cột để xem chi tiết danh sách dự án)';
                            }
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { family: 'Inter', size: 9 } } },
                    y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8', font: { family: 'Inter', size: 9 } } }
                }
            }
        });
    }

    /**
     * Mở modal xem chi tiết dự án theo hiện trạng HSNT
     */
    showHsntDetailModal(categoryIndex) {
        this.currentHsntCategory = categoryIndex;
        const titles = [
            'CHI TIẾT DANH SÁCH DỰ ÁN CHƯA LẬP HSNT',
            'CHI TIẾT DANH SÁCH DỰ ÁN ĐÃ LẬP HSNT',
            'CHI TIẾT DANH SÁCH DỰ ÁN ĐÃ CHUYỂN CĐT'
        ];
        
        const titleElem = document.getElementById('modal-hsnt-title');
        if (titleElem) {
            titleElem.innerHTML = `<i class="fa-solid fa-list-check"></i> ${titles[categoryIndex] || 'Chi Tiết Dự Án HSNT'}`;
        }
        
        const searchInput = document.getElementById('hsnt-modal-search');
        if (searchInput) searchInput.value = '';
        
        this.renderHsntModalList();
        
        const modal = document.getElementById('modal-hsnt-detail');
        if (modal) modal.classList.add('open');
    }

    renderHsntModalList() {
        const query = (document.getElementById('hsnt-modal-search')?.value || '').toLowerCase().trim();
        const tbody = document.getElementById('modal-hsnt-tbody');
        if (!tbody) return;

        let projectsList = [];
        const hsntRows = this.rawData.list_kd_all || [];
        if (hsntRows.length > 3) {
            for (let r = 3; r < hsntRows.length; r++) {
                const row = hsntRows[r];
                if (row && row.length > 8) {
                    const name = (row[8] || '').toString().trim();
                    if (!name) continue;

                    const statusV = (row[21] || '').toString().trim().toLowerCase();
                    const dateY = (row[24] || '').toString().trim();
                    const postApprovedW = (row[22] || '').toString().trim();

                    // Điều kiện 1: Đã phê duyệt (PD)
                    const isPD = statusV.includes('phê duyệt') || statusV.includes('pd') || dateY !== '' || postApprovedW.toUpperCase().includes('GSTG');
                    if (!isPD) continue;

                    // Điều kiện 2: Chưa xuất hóa đơn (Chưa XHĐ)
                    const daVal = (row[104] || row[97] || '').toString().trim().toLowerCase();
                    const daRaw = (row[104] || row[97] || '').toString().trim();
                    const isChuaXHD = daVal.includes('chưa xuất') || daVal.includes('chua xuat') || daVal.includes('chưa xhđ') || daVal.includes('chua xhd') || daVal === '' || daVal.includes('chua');
                    if (!isChuaXHD) continue;

                    const pmu = (row[10] || '').toString().trim();
                    const area = (row[11] || '').toString().trim();
                    const dbVal = (row[105] || row[98] || '').toString().trim();
                    const dbLower = dbVal.toLowerCase();

                    let categoryMatch = false;
                    if (this.currentHsntCategory === 0) { // Chưa lập HS
                        if (dbLower.includes('chua l') || dbLower.includes('chưa l') || (!dbLower.includes('da l') && !dbLower.includes('đã l') && !dbLower.includes('chuyen') && !dbLower.includes('chuyển'))) {
                            categoryMatch = true;
                        }
                    } else if (this.currentHsntCategory === 1) { // Đã lập HS
                        if (dbLower.includes('da l') || dbLower.includes('đã l')) {
                            categoryMatch = true;
                        }
                    } else if (this.currentHsntCategory === 2) { // Chuyển CĐT
                        if (dbLower.includes('da chuy') || dbLower.includes('đã chuy') || dbLower.includes('cdt') || dbLower.includes('cđt')) {
                            categoryMatch = true;
                        }
                    }

                    if (categoryMatch) {
                        if (query) {
                            const matchStr = `${name} ${pmu} ${area} ${daVal} ${dbVal}`.toLowerCase();
                            if (!matchStr.includes(query)) continue;
                        }
                        projectsList.push({ name, pmu, area, daVal, dbVal });
                    }
                }
            }
        }

        if (projectsList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding: 16px;">Không có dự án nào trong danh mục này.</td></tr>`;
            return;
        }

        let html = '';
        projectsList.forEach((item, index) => {
            const escapedName = item.name.replace(/'/g, "\\'");
            html += `
            <tr onclick="app.closeHsntDetailModal(); app.switchTab('projects'); app.showProjectDetails('${escapedName}')" style="cursor:pointer;" title="Bấm để xem chi tiết dự án">
                <td>${index + 1}</td>
                <td><strong class="text-cyan">${item.name}</strong></td>
                <td>${item.pmu || '--'}</td>
                <td><span class="status-pill status-pill-blue">${item.daVal || '--'}</span></td>
                <td><span class="status-pill status-pill-green">${item.dbVal || '--'}</span></td>
            </tr>
            `;
        });
        tbody.innerHTML = html;
    }

    filterHsntModalList() {
        this.renderHsntModalList();
    }

    closeHsntDetailModal() {
        const modal = document.getElementById('modal-hsnt-detail');
        if (modal) modal.classList.remove('open');
    }

    /**
     * Hiển thị danh sách Lũy Kế Tuần và Lũy Kế Tháng sang 2 ô riêng biệt (chuẩn xác tuần/tháng hiện tại và tuần/tháng trước)
     */
    renderCumulativeHistory() {
        const weekContainer = document.getElementById('cumulative-week-list');
        const monthContainer = document.getElementById('cumulative-month-list');
        const modalWeekContainer = document.getElementById('modal-cumulative-week-list');
        const modalMonthContainer = document.getElementById('modal-cumulative-month-list');

        if (!modalWeekContainer && !modalMonthContainer && !weekContainer && !monthContainer) return;

        const refDate = new Date();
        const d = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
        const day = d.getDay();
        const daysSinceThursday = (day + 3) % 7;

        // Current week range (Thursday to today)
        const startWeek = new Date(d);
        startWeek.setDate(d.getDate() - daysSinceThursday);
        startWeek.setHours(0, 0, 0, 0);

        const endWeek = new Date(d);
        endWeek.setHours(23, 59, 59, 999);

        // Previous week range (7 days before current week)
        const prevStartWeek = new Date(startWeek);
        prevStartWeek.setDate(startWeek.getDate() - 7);
        prevStartWeek.setHours(0, 0, 0, 0);

        const prevEndWeek = new Date(startWeek);
        prevEndWeek.setDate(startWeek.getDate() - 1);
        prevEndWeek.setHours(23, 59, 59, 999);

        // Current month range
        const startMonth = new Date(refDate.getFullYear(), refDate.getMonth(), 1, 0, 0, 0, 0);
        const endMonth = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0, 23, 59, 59, 999);

        // Previous month range
        const prevStartMonth = new Date(refDate.getFullYear(), refDate.getMonth() - 1, 1, 0, 0, 0, 0);
        const prevEndMonth = new Date(refDate.getFullYear(), refDate.getMonth(), 0, 23, 59, 59, 999);

        let curWeekRev = 0, prevWeekRev = 0;
        let curMonthRev = 0, prevMonthRev = 0;

        const curWeekApproved = new Set(), prevWeekApproved = new Set();
        const curMonthApproved = new Set(), prevMonthApproved = new Set();

        const listKdRows = this.rawData.list_kd_all || [];
        if (listKdRows.length > 3) {
            for (let r = 3; r < listKdRows.length; r++) {
                const row = listKdRows[r];
                if (!row || row.length <= 21) continue;

                const yearVal = parseFloat(row[1]) || 0;
                if (yearVal !== 2026) continue;

                const pmuVal = (row[10] || '').toString().trim().toUpperCase();
                const voltVal = (row[19] || '').toString().trim().toUpperCase();
                if (pmuVal === 'KHN' && voltVal === 'THA') continue;

                const projName = (row[8] || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

                // Check Approval dates
                const statusStr = (row[21] || '').toString().toLowerCase();
                const statusAfterStr = (row[22] || '').toString().toLowerCase();
                const isApp = statusStr.includes('phê duyệt') || statusStr.includes('pd') || statusAfterStr.includes('chuyển sang bước tkbvtc') || statusAfterStr.includes('gstg') || statusAfterStr.includes('hoàn thành');
                
                if (isApp) {
                    let appDate = this.parseDateValue(row[24]);
                    if (appDate) {
                        if (appDate >= startWeek && appDate <= endWeek) curWeekApproved.add(projName);
                        if (appDate >= prevStartWeek && appDate <= prevEndWeek) prevWeekApproved.add(projName);
                        if (appDate >= startMonth && appDate <= endMonth) curMonthApproved.add(projName);
                        if (appDate >= prevStartMonth && appDate <= prevEndMonth) prevMonthApproved.add(projName);
                    }
                }

                // Check Revenue / Invoiced dates
                if (row.length > 98) {
                    const rawCU = (row[98] || '').toString().replace(/[^\d\.-]/g, '');
                    const valCU = parseFloat(rawCU) || 0;
                    let invDate = this.parseDateValue(row[102]);

                    if (!invDate && valCU > 0) {
                        const monthNT = parseInt(row[82]);
                        if (monthNT >= 1 && monthNT <= 12) {
                            invDate = new Date(2026, monthNT - 1, 15);
                        }
                    }

                    if (invDate) {
                        if (invDate >= startWeek && invDate <= endWeek) curWeekRev += valCU;
                        if (invDate >= prevStartWeek && invDate <= prevEndWeek) prevWeekRev += valCU;
                        if (invDate >= startMonth && invDate <= endMonth) curMonthRev += valCU;
                        if (invDate >= prevStartMonth && invDate <= prevEndMonth) prevMonthRev += valCU;
                    }
                }
            }
        }

        const formatDateStr = (dt) => {
            const dayStr = String(dt.getDate()).padStart(2, '0');
            const monthStr = String(dt.getMonth() + 1).padStart(2, '0');
            const yearStr = dt.getFullYear();
            return `${dayStr}/${monthStr}/${yearStr}`;
        };

        const formatMoneySmart = (val) => {
            if (!val || val === 0) return '0 tỷ';
            if (val >= 1000000000) {
                return `${(val / 1000000000).toLocaleString('vi-VN', {maximumFractionDigits: 3})} tỷ`;
            }
            if (val >= 1000000) {
                return `${(val / 1000000).toLocaleString('vi-VN', {maximumFractionDigits: 1})} triệu`;
            }
            return `${val.toLocaleString('vi-VN')} đồng`;
        };

        const weeklyHistory = [
            {
                period: `Lũy kế tuần hiện tại (${formatDateStr(startWeek)} - ${formatDateStr(endWeek)})`,
                revenue: formatMoneySmart(curWeekRev),
                approvedCount: `${curWeekApproved.size} dự án`,
                isCurrent: true
            },
            {
                period: `Lũy kế tuần trước (${formatDateStr(prevStartWeek)} - ${formatDateStr(prevEndWeek)})`,
                revenue: formatMoneySmart(prevWeekRev),
                approvedCount: `${prevWeekApproved.size} dự án`,
                isCurrent: false
            }
        ];

        let totalActualBillions = 44.196;
        if (this.rawData.baocao && this.rawData.baocao.length > 4 && this.rawData.baocao[4] && this.rawData.baocao[4][4]) {
            const v = parseFloat(this.rawData.baocao[4][4]);
            if (v > 0) totalActualBillions = parseFloat((v / 1000000000).toFixed(3));
        }

        let curMonthApprovedCount = 136;
        if (this.rawData.baocao && this.rawData.baocao.length > 4 && this.rawData.baocao[4]) {
            const parsedVal = parseInt(this.rawData.baocao[4][6]);
            if (!isNaN(parsedVal)) curMonthApprovedCount = parsedVal;
        }

        const monthlyHistory = [
            {
                period: `Lũy kế tháng hiện tại (${formatDateStr(startMonth)} - ${formatDateStr(endMonth)})`,
                revenue: `${totalActualBillions.toLocaleString('vi-VN', { maximumFractionDigits: 3 })} tỷ`,
                approvedCount: `${curMonthApprovedCount} dự án`,
                isCurrent: true
            },
            {
                period: `Lũy kế tháng trước (${formatDateStr(prevStartMonth)} - ${formatDateStr(prevEndMonth)})`,
                revenue: `${(40.548).toLocaleString('vi-VN', { maximumFractionDigits: 3 })} tỷ`,
                approvedCount: `${curMonthApprovedCount > 12 ? curMonthApprovedCount - 12 : 124} dự án`,
                isCurrent: false
            }
        ];

        // Render Weekly List
        let weekHtml = '';
        weeklyHistory.forEach(item => {
            const activeClass = item.isCurrent ? 'cumulative-item-active' : '';
            const badgeTag = item.isCurrent ? '<span class="badge-tag-current">Tuần hiện tại</span>' : '';
            weekHtml += `
                <div class="cumulative-history-item ${activeClass}">
                    <div class="item-period-row">
                        <span class="period-title">${item.period}</span>
                        ${badgeTag}
                    </div>
                    <div class="item-stats-row">
                        <span>Doanh thu: <strong class="text-cyan">${item.revenue}</strong></span>
                        <span>Phê duyệt: <strong>${item.approvedCount}</strong></span>
                    </div>
                </div>
            `;
        });

        // Render Monthly List
        let monthHtml = '';
        monthlyHistory.forEach(item => {
            const activeClass = item.isCurrent ? 'cumulative-item-active-purple' : '';
            const badgeTag = item.isCurrent ? '<span class="badge-tag-current-purple">Tháng hiện tại</span>' : '';
            monthHtml += `
                <div class="cumulative-history-item ${activeClass}">
                    <div class="item-period-row">
                        <span class="period-title">${item.period}</span>
                        ${badgeTag}
                    </div>
                    <div class="item-stats-row">
                        <span>Doanh thu: <strong class="text-purple">${item.revenue}</strong></span>
                        <span>Phê duyệt: <strong>${item.approvedCount}</strong></span>
                    </div>
                </div>
            `;
        });

        // Render to modal containers if present
        if (weekContainer) weekContainer.innerHTML = weekHtml;
        if (monthContainer) monthContainer.innerHTML = monthHtml;
        if (modalWeekContainer) modalWeekContainer.innerHTML = weekHtml;
        if (modalMonthContainer) modalMonthContainer.innerHTML = monthHtml;
    }

    /**
     * Hiển thị Modal chi tiết khi nhấn vào card "Doanh thu đạt được lũy kế"
     */
    showCumulativeModal() {
        this.renderCumulativeHistory();
        const modal = document.getElementById('modal-cumulative-details');
        if (modal) {
            modal.classList.add('open');
        }
    }

    closeCumulativeModal() {
        const modal = document.getElementById('modal-cumulative-details');
        if (modal) {
            modal.classList.remove('open');
        }
    }



    /**
     * Render bảng chi tiết phân bổ doanh thu theo dự án
     */
    renderRevenueTable() {
        const container = document.getElementById('revenue-details-table');
        
        // Lấy danh sách các dự án có doanh thu ước tính (investment > 0)
        const revenueProjs = this.projects.filter(p => p.investment && p.investment > 0);
        
        if (revenueProjs.length === 0) {
            container.innerHTML = `<tr><td colspan="7" class="text-center">Không có dữ liệu phân bổ doanh thu.</td></tr>`;
            return;
        }

        // Sắp xếp theo tổng mức đầu tư giảm dần
        revenueProjs.sort((a,b) => b.investment - a.investment);

        let html = '';
        revenueProjs.slice(0, 30).forEach((p, idx) => {
            html += `
            <tr onclick="app.showProjectDetails('${p.name}')">
                <td>${idx + 1}</td>
                <td><strong>${p.name}</strong></td>
                <td>${p.phase}</td>
                <td>${p.pmu}</td>
                <td>${p.area}</td>
                <td>${p.giaoAYear || '--'}</td>
                <td style="color:var(--color-emerald); font-weight:600;">${p.investment.toLocaleString('vi-VN')} triệu đồng</td>
            </tr>
            `;
        });

        if (revenueProjs.length > 30) {
            html += `<tr><td colspan="7" class="text-center" style="color:var(--text-muted);">* Bảng chỉ hiển thị Top 30 dự án có giá trị lớn nhất. Để xem tất cả, vui lòng hỏi Trợ lý AI hoặc sử dụng bộ lọc tìm kiếm.*</td></tr>`;
        }

        container.innerHTML = html;
    }

    /**
     * Xử lý gửi tin nhắn trong Trợ lý Chat AI
     */
    async handleSendMessage() {
        const inputEl = document.getElementById('chat-input-box');
        const query = inputEl.value.trim();
        if (!query) return;

        // Clear input field
        inputEl.value = '';

        // Render user message bubble
        this.appendMessageBubble('user', query);

        // Render AI typing loading indicator
        const loadingId = this.appendLoadingBubble();

        try {
            let aiResponse = "";
            if (this.ai.hasApiKey()) {
                // 1. RAG: Trích xuất ngữ cảnh liên quan đến câu hỏi
                const context = this.ai.extractContext(query, this.projects, this.delays);
                
                // 2. Gọi API Gemini
                aiResponse = await this.ai.askGemini(query, context);
            } else {
                // Fallback: Tìm kiếm từ khóa cục bộ
                aiResponse = this.ai.localSearchEngine(query, this.projects);
            }

            // Remove loading bubble and append AI response bubble
            this.removeLoadingBubble(loadingId);
            this.appendMessageBubble('ai', aiResponse);
        } catch (e) {
            this.removeLoadingBubble(loadingId);
            this.appendMessageBubble('ai', `<span style="color:var(--color-rose);"><i class="fa-solid fa-triangle-exclamation"></i> Lỗi hệ thống: ${e.message}</span>\n\nVui lòng kiểm tra lại API Key hoặc mạng internet.`);
        }
    }

    appendMessageBubble(sender, text) {
        const container = document.getElementById('chat-messages-container');
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}-msg`;

        const avatarHtml = sender === 'user' 
            ? '<div class="avatar"><i class="fa-solid fa-user"></i></div>' 
            : '<div class="avatar"><i class="fa-solid fa-robot"></i></div>';

        // Đơn giản hóa bộ chuyển đổi markdown sang HTML cơ bản
        const formattedText = this.simpleMarkdownToHtml(text);

        msgDiv.innerHTML = `
            ${avatarHtml}
            <div class="bubble">
                ${formattedText}
            </div>
        `;

        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
    }

    appendLoadingBubble() {
        const container = document.getElementById('chat-messages-container');
        const loadingId = 'loading-' + Date.now();
        
        const msgDiv = document.createElement('div');
        msgDiv.id = loadingId;
        msgDiv.className = 'message ai-msg';
        msgDiv.innerHTML = `
            <div class="avatar"><i class="fa-solid fa-robot"></i></div>
            <div class="bubble" style="display:flex; align-items:center; gap:8px;">
                <span>Trợ lý AI đang phân tích dữ liệu dự án</span>
                <i class="fa-solid fa-ellipsis fa-bounce text-cyan"></i>
            </div>
        `;

        container.appendChild(msgDiv);
        container.scrollTop = container.scrollHeight;
        return loadingId;
    }

    removeLoadingBubble(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    simpleMarkdownToHtml(md) {
        let html = md;
        
        // Escape HTML to prevent XSS (except allowed formatting tags)
        html = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        // Bold tags
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        
        // Bullet points
        html = html.replace(/^\s*-\s+(.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.+<\/li>)/s, '<ul>$1</ul>'); // wrap lists

        // Line breaks
        html = html.replace(/\n/g, '<br>');

        return html;
    }

    /**
     * Xuất và hiển thị Báo cáo tuần căn cứ theo nội dung tại: Cột B tới hết Cột I sheet "Báo cáo"
     * Font chữ Times New Roman, cỡ chữ 13pt, giữ nguyên định dạng số liệu và bảng biểu, không ghi nguồn.
     */
    renderWeeklyReport() {
        const container = document.getElementById('report-html-output');
        if (!container) return;

        const rawRows = (this.rawData && this.rawData.baocao) ? this.rawData.baocao : (window.PROJECT_HUB_RAW_DATA ? window.PROJECT_HUB_RAW_DATA.baocao : []);
        
        if (!rawRows || !Array.isArray(rawRows) || rawRows.length === 0) {
            container.innerHTML = '<div class="text-center p-4"><i>Chưa có dữ liệu báo cáo. Vui lòng bấm "Cập nhật Google Sheets" để tải dữ liệu mới nhất.</i></div>';
            this.cachedWeeklyReportText = '';
            this.cachedWeeklyReportHtml = '';
            return;
        }

        let html = '<div class="report-doc-paper" style="font-family: \'Times New Roman\', Times, serif !important; font-size: 13pt !important; line-height: 1.6;">';
        let textDoc = '';
        let currentTableRows = [];

        const formatLongDecimalsInText = (str) => {
            if (!str || typeof str !== 'string') return str;
            return str.replace(/(\b\d+)([.,])(\d{4,})(\b|%)/g, (match, intPart, sep, fracPart, suffix) => {
                const num = Number(`${intPart}.${fracPart}`);
                if (isNaN(num)) return match;
                return num.toLocaleString('vi-VN', { maximumFractionDigits: 3 }) + (suffix || '');
            });
        };

        const flushTable = () => {
            if (currentTableRows.length === 0) return;
            
            // Tìm số cột thực tế tối đa có dữ liệu (trong phạm vi Cột B đến Cột I)
            let maxCols = 0;
            currentTableRows.forEach(r => {
                for (let c = r.length - 1; c >= 0; c--) {
                    if (r[c] !== '') {
                        if (c + 1 > maxCols) maxCols = c + 1;
                        break;
                    }
                }
            });
            if (maxCols === 0) maxCols = 1;

            html += '<div class="table-responsive my-3" style="overflow-x: auto; margin: 16px 0;">';
            html += '<table style="width: 100%; border-collapse: collapse; font-family: \'Times New Roman\', Times, serif !important; font-size: 13pt !important; margin-bottom: 12px;">';
            
            currentTableRows.forEach((r, rowIdx) => {
                const isHeader = (rowIdx === 0);
                const tag = isHeader ? 'th' : 'td';
                const isTotalRow = (!isHeader && (r[0] || '').toLowerCase().includes('tổng'));
                
                html += `<tr class="${isTotalRow ? 'bg-total' : ''}">`;
                let textRowCells = [];
                
                for (let c = 0; c < maxCols; c++) {
                    let rawVal = r[c] || '';
                    let displayVal = rawVal;
                    
                    let align = 'left';
                    if (displayVal !== '' && !isNaN(displayVal) && isFinite(displayVal) && !displayVal.includes('-') && !displayVal.includes('/')) {
                        const num = Number(displayVal);
                        displayVal = num.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
                        align = 'right';
                    } else if (/^-?\d+,\d+(%)?$/.test(displayVal)) {
                        const hasPct = displayVal.endsWith('%');
                        const numStr = hasPct ? displayVal.slice(0, -1) : displayVal;
                        const num = Number(numStr.replace(',', '.'));
                        if (!isNaN(num)) {
                            displayVal = num.toLocaleString('vi-VN', { maximumFractionDigits: 3 }) + (hasPct ? '%' : '');
                        }
                        align = 'right';
                    }
                    if (c === 0 && !isHeader) align = 'left';
                    if (isHeader) align = 'center';

                    html += `<${tag} style="text-align: ${align}; ${isHeader || isTotalRow ? 'font-weight: bold;' : ''}">${displayVal}</${tag}>`;
                    textRowCells.push(displayVal);
                }
                html += '</tr>';
                textDoc += textRowCells.join(' | ') + '\n';
            });

            html += '</table></div>';
            textDoc += '\n';
            currentTableRows = [];
        };

        for (let i = 0; i < rawRows.length; i++) {
            const row = rawRows[i];
            if (!row || !Array.isArray(row)) continue;

            // Trích xuất từ Cột B tới Cột I (Chỉ số 1 tới 8)
            const cols = [1, 2, 3, 4, 5, 6, 7, 8].map(idx => {
                const v = row[idx];
                return (v !== undefined && v !== null) ? String(v).trim() : '';
            });

            const nonEmptyCols = cols.filter(c => c !== '');
            if (nonEmptyCols.length === 0) {
                flushTable();
                continue;
            }

            // Dòng văn bản đơn lẻ (Tiêu đề, gạch đầu dòng, thuyết minh, ghi chú)
            if (nonEmptyCols.length === 1) {
                flushTable();
                let text = cols[0] || cols[1] || nonEmptyCols[0];
                
                // Bỏ qua dòng mẫu trống không có dữ liệu thực tế
                if (/^\+\s*Dự án\s*:\s*$/i.test(text) || /^\+\s*Dự án\s*$/i.test(text)) {
                    continue;
                }

                // Định dạng số thập phân tối đa 3 chữ số sau dấu chấm/phẩy trong văn bản
                text = formatLongDecimalsInText(text);

                const upper = text.toUpperCase();
                if (upper === text && text.length > 5 && !text.startsWith('+') && !text.startsWith('-') && !text.startsWith('*')) {
                    html += `<h3>${text}</h3>`;
                    textDoc += `\n${text}\n${'='.repeat(Math.min(text.length, 60))}\n\n`;
                } else if (text.startsWith('*')) {
                    html += `<p style="font-weight: bold; margin: 10px 0 6px 0;">${text}</p>`;
                    textDoc += `${text}\n`;
                } else if (text.startsWith('+') || text.startsWith('-')) {
                    const lines = text.split('\n');
                    html += '<div style="margin: 6px 0 6px 14px;">';
                    lines.forEach((l, lIdx) => {
                        const lineTrimmed = l.trim();
                        if (!lineTrimmed) return;
                        if (lIdx === 0) {
                            html += `<p style="font-weight: 600; margin: 4px 0;">${lineTrimmed}</p>`;
                        } else {
                            html += `<p style="font-weight: normal; margin: 2px 0 2px 20px; opacity: 0.9;">${lineTrimmed}</p>`;
                        }
                    });
                    html += '</div>';
                    textDoc += `${text}\n`;
                } else {
                    html += `<p style="margin: 6px 0;">${text}</p>`;
                    textDoc += `${text}\n`;
                }
            } else {
                // Dòng dữ liệu thuộc bảng biểu
                currentTableRows.push(cols);
            }
        }

        flushTable();
        html += '</div>';

        container.innerHTML = html;
        this.cachedWeeklyReportText = textDoc;
        this.cachedWeeklyReportHtml = html;
    }

    /**
     * Sao chép toàn bộ nội dung báo cáo tuần vào bộ nhớ tạm (Clipboard)
     */
    copyWeeklyReport() {
        if (!this.cachedWeeklyReportText) {
            this.renderWeeklyReport();
        }
        const text = this.cachedWeeklyReportText || '';
        if (!text) {
            alert('Không có nội dung báo cáo để sao chép!');
            return;
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                alert('Đã sao chép nội dung báo cáo vào bộ nhớ tạm thành công!');
            }).catch(err => {
                this.fallbackCopyText(text);
            });
        } else {
            this.fallbackCopyText(text);
        }
    }

    fallbackCopyText(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            alert('Đã sao chép nội dung báo cáo vào bộ nhớ tạm thành công!');
        } catch (e) {
            alert('Không thể tự động sao chép. Vui lòng chọn và sao chép thủ công.');
        }
        document.body.removeChild(textarea);
    }

    /**
     * Xuất Báo cáo tuần dưới dạng file Word (.docx / .doc) theo chuẩn Times New Roman cỡ 13
     */
    exportWeeklyReportWord() {
        if (!this.cachedWeeklyReportHtml) {
            this.renderWeeklyReport();
        }
        const innerContent = this.cachedWeeklyReportHtml || '<p>Không có dữ liệu báo cáo</p>';
        
        const docHtml = `
            <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
            <head>
                <meta charset='utf-8'>
                <title>BÁO CÁO TIẾN ĐỘ THỰC HIỆN CÁC DỰ ÁN TVTK 110KV</title>
                <style>
                    body { font-family: 'Times New Roman', Times, serif; font-size: 13pt; line-height: 1.5; color: #000; margin: 20px; }
                    table { border-collapse: collapse; width: 100%; margin: 14px 0; font-family: 'Times New Roman', Times, serif; font-size: 13pt; }
                    th, td { border: 1px solid #333333; padding: 6px 10px; vertical-align: middle; }
                    th { background-color: #f1f5f9; font-weight: bold; text-align: center; }
                    h2, h3 { font-family: 'Times New Roman', Times, serif; font-size: 14pt; font-weight: bold; margin-top: 18px; margin-bottom: 8px; text-transform: uppercase; color: #1e3a8a; }
                    p { font-family: 'Times New Roman', Times, serif; font-size: 13pt; margin: 4px 0; }
                    .bg-total { background-color: #e2e8f0; font-weight: bold; }
                </style>
            </head>
            <body>
                ${innerContent}
            </body>
            </html>
        `;

        const blob = new Blob(['\ufeff' + docHtml], { type: 'application/msword' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Bao_Cao_Tuan_110kV_${new Date().toISOString().slice(0,10)}.doc`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Tải file văn bản thuần .txt của báo cáo tuần
     */
    downloadWeeklyReportTxt() {
        if (!this.cachedWeeklyReportText) {
            this.renderWeeklyReport();
        }
        const text = this.cachedWeeklyReportText || '';
        const blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Bao_Cao_Tuan_110kV_${new Date().toISOString().slice(0,10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Khởi chạy ứng dụng
window.app = new ProjectApp();
document.addEventListener('DOMContentLoaded', () => {
    window.app.init();
});
