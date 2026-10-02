/**
 * chat-helper.js
 * Xử lý logic RAG (tra cứu ngữ cảnh) cục bộ và tương tác với Gemini API.
 */

class AIChatAssistant {
    constructor() {
        this.apiKey = localStorage.getItem('gemini_api_key') || '';
        // Clear deprecated 1.5 models from storage
        const savedModel = localStorage.getItem('gemini_model');
        if (!savedModel || savedModel.startsWith('gemini-1.')) {
            localStorage.removeItem('gemini_model');
        }
        this.model = localStorage.getItem('gemini_model') || 'gemini-2.5-flash';
        this.apiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
        this.systemInstruction = `Bạn là Trợ lý AI chuyên nghiệp cho hệ thống TVTK 110kV NPSC. 
Nhiệm vụ của bạn là giải đáp các thắc mắc về tiến độ, vướng mắc, đơn vị quản lý, doanh thu và nhân sự chủ trì các dự án dựa trên dữ liệu ngữ cảnh được cung cấp.

Quy tắc trả lời BẮT BUỘC:
1. Bạn CHỈ ĐƯỢC PHÉP đưa ra câu trả lời chứa thông tin của các dự án được liệt kê trong phần DỮ LIỆU NGỮ CẢNH DỰ ÁN LIÊN QUAN bên dưới.
2. TUYỆT ĐỐI KHÔNG tự bịa ra hoặc đưa thêm bất kỳ dự án nào khác nằm ngoài danh sách ngữ cảnh được cung cấp.
3. Khi người dùng tìm kiếm cụm từ (ví dụ "Từ Sơn"), bạn CHỈ ĐƯỢC PHÉP trả lời đúng các dự án chứa chính xác cả cụm từ đó (ví dụ chứa cụm từ "Từ Sơn"). KHÔNG ĐƯỢC tự ý liệt kê các dự án chứa riêng lẻ từng từ rời rạc.
4. Trả lời một cách ngắn gọn, rõ ràng, tập trung trực tiếp vào câu hỏi. KHÔNG hiển thị câu ví dụ hay hướng dẫn mẫu trong câu trả lời.
5. Trình bày câu trả lời dưới dạng Markdown đẹp mắt (sử dụng in đậm, danh sách gạch đầu dòng).
6. Khi nhắc đến Tổng mức đầu tư (TMĐT), đơn vị mặc định là triệu đồng.`;
    }

    setApiKey(key) {
        this.apiKey = key;
        localStorage.setItem('gemini_api_key', key);
    }

    setModel(modelName) {
        this.model = modelName;
        localStorage.setItem('gemini_model', modelName);
    }

    clearApiKey() {
        this.apiKey = '';
        localStorage.removeItem('gemini_api_key');
    }

    hasApiKey() {
        return this.apiKey && this.apiKey.trim().length > 0;
    }

    removeAccents(str) {
        if (!str) return '';
        return str.toString()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd').replace(/Đ/g, 'D')
            .toLowerCase()
            .replace(/tp\.\s*/g, '')
            .replace(/tỉnh\s*/g, '')
            .replace(/thành phố\s*/g, '')
            .trim();
    }

    /**
     * Tìm kiếm ngặt nghèo các dự án khớp đúng chính xác cụm từ tìm kiếm (Tên, QLDA, Khu vực)
     * @param {string} query 
     * @param {Array} projects 
     * @returns {Array} Danh sách dự án thỏa mãn điều kiện
     */
    findStrictMatchingProjects(query, projects) {
        if (!query || !projects || projects.length === 0) return [];
        const normQuery = this.removeAccents(query).trim();
        if (!normQuery) return [];

        // 1. Kiểm tra khớp theo Khu vực hoặc PMU của Khu vực đó
        const areaPmuMap = [
            { areaName: 'Thái Nguyên', normArea: 'thai nguyen', pmus: ['pctn', 'pc thai nguyen'] },
            { areaName: 'Quảng Ninh', normArea: 'quang ninh', pmus: ['pcqn', 'pc quang ninh'] },
            { areaName: 'Nghệ An', normArea: 'nghe an', pmus: ['pcna', 'pc nghe an'] },
            { areaName: 'Hà Tĩnh', normArea: 'ha tinh', pmus: ['pcht', 'pc ha tinh'] },
            { areaName: 'Phú Thọ', normArea: 'phu tho', pmus: ['pcpt', 'pc phu tho'] },
            { areaName: 'Hải Phòng', normArea: 'hai phong', pmus: ['pchp', 'pc hai phong'] },
            { areaName: 'Ninh Bình', normArea: 'ninh binh', pmus: ['pcnb', 'pc ninh binh'] },
            { areaName: 'Lào Cai', normArea: 'lao cai', pmus: ['pclc', 'pc lao cai'] },
            { areaName: 'Lạng Sơn', normArea: 'lang son', pmus: ['pcls', 'pc lang son'] },
            { areaName: 'Bắc Ninh', normArea: 'bac ninh', pmus: ['pcbn', 'pc bac ninh'] },
            { areaName: 'Hưng Yên', normArea: 'hung yen', pmus: ['pchy', 'pc hung yen'] },
            { areaName: 'Thanh Hóa', normArea: 'thanh hoa', pmus: ['pcth', 'pc thanh hoa'] },
            { areaName: 'Tuyên Quang', normArea: 'tuyen quang', pmus: ['pctq', 'pc tuyen quang'] },
            { areaName: 'Cao Bằng', normArea: 'cao bang', pmus: ['pccb', 'pc cao bang'] },
            { areaName: 'Lai Châu', normArea: 'lai chau', pmus: ['pclch', 'pc lai chau'] },
            { areaName: 'Điện Biên', normArea: 'dien bien', pmus: ['pcdb', 'pc dien bien'] },
            { areaName: 'Sơn La', normArea: 'son la', pmus: ['pcsl', 'pc son la'] }
        ];

        for (const entry of areaPmuMap) {
            let isMatched = normQuery === entry.normArea || normQuery.includes(entry.normArea);
            if (!isMatched) {
                for (const pmuAlias of entry.pmus) {
                    const regex = new RegExp(`\\b${pmuAlias}\\b`, 'i');
                    if (regex.test(normQuery)) {
                        isMatched = true;
                        break;
                    }
                }
            }
            if (isMatched) {
                return projects.filter(p => {
                    const pArea = this.removeAccents(p.area);
                    const pName = this.removeAccents(p.name);
                    const pPmu = this.removeAccents(p.pmu);

                    return pArea === entry.normArea || pArea.includes(entry.normArea) || pName.includes(entry.normArea) || entry.pmus.includes(pPmu);
                });
            }
        }

        // 2. Kiểm tra khớp trực tiếp theo Đơn vị QLDA (BA1, BA2, NPSC, PEC...)
        const uniquePmus = Array.from(new Set(projects.map(p => (p.pmu || '').trim()).filter(Boolean)));
        for (const pmu of uniquePmus) {
            const normPmu = this.removeAccents(pmu);
            if (normPmu.length >= 2) {
                const regex = new RegExp(`\\b${normPmu}\\b`, 'i');
                if (regex.test(normQuery)) {
                    return projects.filter(p => {
                        const pPmu = this.removeAccents(p.pmu);
                        return pPmu === normPmu;
                    });
                }
            }
        }

        // 3. KHỚP CHÍNH XÁC NGUYÊN CỤM TỪ (EXACT PHRASE MATCHING)
        // Tuyệt đối không tách rời các từ trong cụm từ (Ví dụ: "Từ sơn" -> bắt buộc phải chứa nguyên cụm "tu son")
        const phraseMatches = projects.filter(p => {
            const normName = this.removeAccents(p.name);
            const normArea = this.removeAccents(p.area);
            const normBottlenecks = this.removeAccents(p.bottlenecks);

            return normName.includes(normQuery) || normArea.includes(normQuery) || normBottlenecks.includes(normQuery);
        });

        if (phraseMatches.length > 0) {
            return phraseMatches;
        }

        // 4. Kiểm tra truy vấn dự án chậm tiến độ / vướng mắc
        if (normQuery.includes('cham') || normQuery.includes('tre') || normQuery.includes('vuong')) {
            return projects.filter(p => p.isDelayed || p.isNearDelayed || p.bottlenecks);
        }

        return [];
    }

    /**
     * Tìm kiếm và trích xuất ngữ cảnh liên quan từ cơ sở dữ liệu dự án
     * @param {string} query Câu hỏi của người dùng
     * @param {Array} projects Danh sách toàn bộ dự án
     * @param {Array} delays Danh sách dự án chậm trễ
     */
    extractContext(query, projects, delays) {
        if (!projects || projects.length === 0) return 'Không có dữ liệu dự án nào trong hệ thống.';

        const matchedProjects = this.findStrictMatchingProjects(query, projects);

        if (matchedProjects.length === 0) {
            return `### DỮ LIỆU NGỮ CẢNH DỰ ÁN LIÊN QUAN:\n*Hệ thống không tìm thấy dự án nào thỏa mãn chính xác các điều kiện tìm kiếm trong câu hỏi "${query}". Bạn hãy lịch sự phản hồi cho người dùng biết không tìm thấy dự án nào thuộc điều kiện này và TUYỆT ĐỐI KHÔNG tự liệt kê các dự án khác.*`;
        }

        let contextText = `### DỮ LIỆU NGỮ CẢNH DỰ ÁN LIÊN QUAN (Tổng cộng ${matchedProjects.length} dự án khớp đúng điều kiện):\n`;
        contextText += `*(Lưu ý BẮT BUỘC: Bạn BẮT BUỘC CHỈ ĐƯỢC phép trả lời thông tin dựa trên đúng ${matchedProjects.length} dự án dưới đây. TUYỆT ĐỐI KHÔNG liệt kê thêm bất kỳ dự án nào khác không thuộc danh sách này)*\n`;

        matchedProjects.forEach((p, index) => {
            contextText += `\n**Dự án ${index + 1}: ${p.name}**\n`;
            contextText += `- Đơn vị quản lý (QLDA): ${p.pmu || 'N/A'}\n`;
            contextText += `- Giai đoạn: ${p.phase || 'N/A'}\n`;
            contextText += `- Khu vực/Tỉnh: ${p.area || 'N/A'}\n`;
            contextText += `- Hiện trạng: ${p.status || 'N/A'} (${p.statusAfterApproved || 'N/A'})\n`;
            contextText += `- Cán bộ chủ trì: ${p.leader || 'N/A'} (Nhóm: ${p.leaderGroup || 'N/A'})\n`;
            if (p.investment) contextText += `- Tổng mức đầu tư: ${(typeof p.investment === 'number' ? p.investment.toLocaleString('vi-VN') : p.investment)} triệu đồng\n`;
            if (p.contractNo) contextText += `- Số Hợp đồng: ${p.contractNo} (Ngày ký: ${p.contractDate || 'N/A'}, Thời hạn: ${p.contractDuration || 'N/A'} ngày)\n`;
            if (p.hsntStatus) contextText += `- Hiện trạng HSNT (Cột DB): ${p.hsntStatus}\n`;
            if (p.overallSummary) contextText += `- TÌNH HÌNH CHUNG: ${p.overallSummary.trim()}\n`;
            if (p.weeklyLog) contextText += `- NHẬT KÝ CÔNG VIỆC TRONG TUẦN: ${p.weeklyLog.trim()}\n`;
            if (p.expectedNextWeek) contextText += `- DỰ KIẾN KẾ HOẠCH TUẦN TỚI: ${p.expectedNextWeek.trim()}\n`;
            
            if (p.bottlenecks) {
                contextText += `- VƯỚNG MẮC / NGUYÊN NHÂN CHẬM TRỄ: ${p.bottlenecks}\n`;
                if (p.resolution) contextText += `- HƯỚNG GIẢI QUYẾT: ${p.resolution}\n`;
            }
        });

        return contextText;
    }

    /**
     * Gửi câu hỏi kèm ngữ cảnh đến Gemini API
     */
    async askGemini(prompt, context) {
        if (!this.hasApiKey()) {
            throw new Error('API Key chưa được cấu hình.');
        }

        const fullPrompt = `${this.systemInstruction}\n\n${context}\n\n--- Trả lời câu hỏi này của người dùng:\nCâu hỏi: ${prompt}`;

        const fallbackChain = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-2.0-flash-lite'];
        const modelsToTry = [this.model];
        fallbackChain.forEach(m => {
            if (!modelsToTry.includes(m)) modelsToTry.push(m);
        });

        const apiVersions = ['v1', 'v1beta'];
        let lastError = null;
        let quotaExceededModels = [];

        for (const model of modelsToTry) {
            let modelFailed = false;
            for (const version of apiVersions) {
                try {
                    const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${this.apiKey}`;
                    console.log(`Trying model: ${model} via API ${version}...`);

                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: fullPrompt }] }]
                        })
                    });

                    if (!response.ok) {
                        const errData = await response.json();
                        const errMsg = errData.error?.message || 'Lỗi không xác định.';
                        const status = response.status;

                        if (status === 429 || errMsg.toLowerCase().includes('quota')) {
                            console.warn(`Quota exceeded for model ${model}. Trying next model...`);
                            quotaExceededModels.push(model);
                            lastError = new Error(`QUOTA_EXCEEDED:${model}`);
                            modelFailed = true;
                            break;
                        }

                        if (status === 404 || errMsg.toLowerCase().includes('not found') || errMsg.toLowerCase().includes('not supported')) {
                            lastError = new Error(errMsg);
                            continue;
                        }

                        if (status === 400 || status === 403) {
                            throw new Error(`Lỗi xác thực API Key (${status}): ${errMsg}`);
                        }

                        lastError = new Error(errMsg);
                        continue;
                    }

                    const data = await response.json();
                    const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (!textResponse) throw new Error('Mô hình không trả về kết quả.');

                    const note = model !== this.model ? `\n\n---\n*⚠️ Lưu ý: Đã tự động chuyển sang mô hình **${model}** do mô hình ${this.model} hết quota.*` : '';
                    return textResponse + note;

                } catch (error) {
                    if (error.message.startsWith('Lỗi xác thực')) throw error;
                    lastError = error;
                    console.error(`Error (model=${model}, ver=${version}):`, error.message);
                }
            }
            if (modelFailed) continue;
        }

        if (quotaExceededModels.length > 0) {
            throw new Error(
                `Hết quota miễn phí API Key của bạn trên tất cả các mô hình đã thử (${quotaExceededModels.join(', ')}).\n\n` +
                `**Giải pháp:**\n` +
                `1. **Chờ quota tự động reset** — Quota miễn phí thường reset sau 1 phút hoặc hàng ngày.\n` +
                `2. **Bật thanh toán (Billing)** tại [Google AI Studio](https://aistudio.google.com/) để có giới hạn cao hơn.\n` +
                `3. **Tạo API Key mới** từ Google AI Studio nếu key cũ đã hết hạn mức.\n` +
                `4. **Dùng tìm kiếm cục bộ** — Xóa API Key để dùng tính năng tìm kiếm offline miễn phí ngay bây giờ.`
            );
        }

        throw lastError || new Error('Không thể kết nối đến Gemini API.');
    }

    /**
     * Bộ máy tìm kiếm từ khóa cục bộ khi không có API Key
     * @param {string} query 
     * @param {Array} projects 
     */
    localSearchEngine(query, projects) {
        const lowerQuery = query ? query.toLowerCase().trim() : '';
        const normQuery = this.removeAccents(query);

        const matched = this.findStrictMatchingProjects(query, projects);

        if (matched.length === 0) {
            return `Không tìm thấy dự án nào thỏa mãn điều kiện tìm kiếm "${query}". Vui lòng thử nhập tên dự án cụ thể (ví dụ: 'Ngọc Long', 'Núi Cốc'), tên khu vực ('Thái Nguyên', 'Quảng Ninh') hoặc đơn vị QLDA ('BA1', 'PCTN').`;
        }

        let reply = `### KẾT QUẢ TÌM KIẾM DỰ ÁN KHỚP ĐÚNG ĐIỀU KIỆN ("${query}") - TỔNG CỘNG: ${matched.length} DỰ ÁN\n\n`;
        matched.forEach((p, idx) => {
            reply += `${idx + 1}. **${p.name}**\n`;
            reply += `   - **Đơn vị QLDA:** ${p.pmu || 'N/A'} | **Khu vực:** ${p.area || 'N/A'} | **Giai đoạn:** ${p.phase || 'N/A'}\n`;
            reply += `   - **Hiện trạng:** ${p.status || 'N/A'} (${p.statusAfterApproved || 'N/A'})\n`;
            if (p.investment) reply += `   - **TMĐT:** ${(typeof p.investment === 'number' ? p.investment.toLocaleString('vi-VN') : p.investment)} triệu đồng\n`;
            if (p.leader) reply += `   - **Cán bộ chủ trì:** ${p.leader} (Nhóm: ${p.leaderGroup || 'N/A'})\n`;
            if (p.hsntStatus) reply += `   - **Hiện trạng HSNT (Cột DB):** ${p.hsntStatus}\n`;
            if (p.overallSummary) reply += `   - **Tình hình chung:** ${p.overallSummary.trim()}\n`;
            if (p.weeklyLog) reply += `   - **Nhật ký trong tuần:** ${p.weeklyLog.trim()}\n`;
            if (p.expectedNextWeek) reply += `   - **Dự kiến tuần tới:** ${p.expectedNextWeek.trim()}\n`;
            if (p.bottlenecks) reply += `   - *Vướng mắc:* ${p.bottlenecks}\n`;
            if (p.resolution) reply += `   - *Hướng giải quyết:* ${p.resolution}\n`;
            reply += `\n`;
        });

        return reply;
    }
}
window.AIChatAssistant = AIChatAssistant;
