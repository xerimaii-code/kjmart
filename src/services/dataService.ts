import { Customer, Order, Product, OrderItem } from "../types";

// Assuming these libraries are loaded from CDN
declare const XLSX: any;
declare const jsPDF: any;
declare const JsBarcode: any;

const loadedScripts: { [src: string]: Promise<void> } = {};

/**
 * Dynamically loads a script from a given URL and ensures it's only loaded once.
 * @param src The URL of the script to load.
 * @returns A promise that resolves when the script is loaded.
 */
export const loadScript = (src: string): Promise<void> => {
    if (loadedScripts[src]) {
        return loadedScripts[src];
    }

    const promise = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => {
            resolve();
        };
        script.onerror = () => {
            reject(new Error(`Failed to load script: ${src}`));
            delete loadedScripts[src]; // Allow retrying
        };
        document.head.appendChild(script);
    });

    loadedScripts[src] = promise;
    return promise;
};

const XLSX_CDN = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const JSPDF_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const JSBARCODE_CDN = "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js";


export interface ParsedResult<T> {
    valid: T[];
    invalidCount: number;
    errors: string[];
}


// --- FILE PARSING & PROCESSING IN WORKER ---

const workerCode = `
    const XLSX_CDN = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    try {
        self.importScripts(XLSX_CDN);
    } catch (e) {
        self.postMessage({ status: 'error', error: "엑셀 라이브러리를 로드하는 데 실패했습니다." });
        self.close();
    }
    
    // --- Helper functions moved into worker scope ---

    const isValidFirebaseKey = (key) => {
        if (!key) return false;
        return !/[.#$[\\]/]/.test(key);
    };

    const processCustomerData = (rows) => {
        const valid = [];
        const errors = [];
        rows.forEach((row, index) => {
            const comcode = String(row[0] || '').trim();
            const name = String(row[1] || '').trim();
            if (!comcode) {
                errors.push(\`\${index + 2}행: 거래처 코드 필드가 비어있습니다.\`);
                return;
            }
            if (!isValidFirebaseKey(comcode)) {
                errors.push(\`\${index + 2}행: 거래처 코드에 유효하지 않은 문자(. # $ [ ] /)가 포함되어 있습니다: '\${comcode}'\`);
                return;
            }
            if (!name) {
                errors.push(\`\${index + 2}행: 거래처명 필드가 비어있습니다.\`);
                return;
            }
            valid.push({ comcode, name });
        });
        return { valid, invalidCount: errors.length, errors };
    };
    
    const processProductData = (rows) => {
        const valid = [];
        const errors = [];
        const excelSerialDateToJSDate = (serial) => {
            if (typeof serial !== 'number' || isNaN(serial)) return null;
            const utc_days = Math.floor(serial - 25569);
            const utc_value = utc_days * 86400;
            const date_info = new Date(utc_value * 1000);
            return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate());
        };
        rows.forEach((row, index) => {
            const barcode = String(row[0] || '').trim();
            const name = String(row[1] || '').trim();
            const costPrice = parseFloat(String(row[2]));
            const sellingPrice = parseFloat(String(row[3]));
            const salePriceRaw = row[4];
            const salePrice = salePriceRaw !== null && salePriceRaw !== undefined ? String(salePriceRaw).trim() : undefined;
            const saleEndDateRaw = row[5];
            const supplierName = String(row[6] || '').trim();
            if (!barcode) {
                errors.push(\`\${index + 2}행: 바코드(A) 필드가 비어있습니다.\`);
                return;
            }
            if (!isValidFirebaseKey(barcode)) {
                errors.push(\`\${index + 2}행: 바코드에 유효하지 않은 문자(. # $ [ ] /)가 포함되어 있습니다: '\${barcode}'\`);
                return;
            }
            if (!name) {
                errors.push(\`\${index + 2}행: 품명(B) 필드가 비어있습니다.\`);
                return;
            }
            let saleEndDate = undefined;
            if (saleEndDateRaw !== null && saleEndDateRaw !== undefined && String(saleEndDateRaw).trim() !== '') {
                let dateObj = null;
                if (typeof saleEndDateRaw === 'number') {
                    dateObj = excelSerialDateToJSDate(saleEndDateRaw);
                } else if (typeof saleEndDateRaw === 'string') {
                    const localDateString = String(saleEndDateRaw).split('T')[0].replace(/-/g, '/');
                    dateObj = new Date(localDateString);
                }
                if (dateObj && !isNaN(dateObj.getTime())) {
                    const year = dateObj.getFullYear();
                    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
                    const day = dateObj.getDate().toString().padStart(2, '0');
                    saleEndDate = \`\${year}-\${month}-\${day}\`;
                } else {
                    errors.push(\`\${index + 2}행: 행사종료일(F)의 날짜 형식('\${saleEndDateRaw}')이 올바르지 않습니다.\`);
                }
            }
            const product = {
                barcode, name,
                costPrice: isNaN(costPrice) ? 0 : costPrice,
                sellingPrice: isNaN(sellingPrice) ? 0 : sellingPrice,
            };
            if (salePrice) product.salePrice = salePrice;
            if (saleEndDate) product.saleEndDate = saleEndDate;
            if (supplierName) product.supplierName = supplierName;
            valid.push(product);
        });
        return { valid, invalidCount: errors.length, errors };
    };

    self.onmessage = (e) => {
        const { file, type } = e.data;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                if (!event.target?.result) throw new Error("파일을 읽을 수 없습니다.");
                
                self.postMessage({ status: 'progress', message: '파일 읽는 중...' });
                const data = new Uint8Array(event.target.result);
                
                self.postMessage({ status: 'progress', message: '엑셀 데이터 분석 중...' });
                const workbook = self.XLSX.read(data, { type: 'array' });
                if (!workbook.SheetNames || workbook.SheetNames.length === 0) throw new Error("엑셀 파일에서 시트를 찾을 수 없습니다.");

                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const json = self.XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                const dataRows = Array.isArray(json) && json.length > 1 ? json.slice(1) : [];
                const isRowEmpty = (row) => !row || row.length === 0 || row.every(cell => cell === null || cell === undefined || String(cell).trim() === '');
                let lastNonEmptyRowIndex = -1;
                for (let i = dataRows.length - 1; i >= 0; i--) {
                    if (!isRowEmpty(dataRows[i])) { lastNonEmptyRowIndex = i; break; }
                }
                const trimmedData = dataRows.slice(0, lastNonEmptyRowIndex + 1);
                
                self.postMessage({ status: 'progress', message: \`파일 분석 완료. \${trimmedData.length}개 행 처리합니다.\` });
                const parsedResult = type === 'customer' ? processCustomerData(trimmedData) : processProductData(trimmedData);

                self.postMessage({ status: 'complete', data: parsedResult });

            } catch (error) {
                self.postMessage({ status: 'error', error: error.message });
            }
        };
        reader.onerror = () => self.postMessage({ status: 'error', error: "Worker에서 파일을 읽을 수 없습니다." });
        reader.readAsArrayBuffer(file);
    };
`;

export const processExcelFileInWorker = <T extends Customer | Product>(
    file: File | Blob, 
    type: 'customer' | 'product',
    onProgress: (message: string) => void
): Promise<ParsedResult<T>> => {
    return new Promise((resolve, reject) => {
        const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(workerBlob);
        const worker = new Worker(workerUrl);

        worker.onmessage = (e) => {
            const { status, message, data, error } = e.data;
            
            if (status === 'progress') {
                onProgress(message);
            } else if (status === 'complete') {
                URL.revokeObjectURL(workerUrl);
                worker.terminate();
                resolve(data as ParsedResult<T>);
            } else if (status === 'error') {
                URL.revokeObjectURL(workerUrl);
                worker.terminate();
                const err = new Error(error);
                reject(err);
            }
        };

        worker.onerror = (e) => {
            URL.revokeObjectURL(workerUrl);
            worker.terminate();
            reject(new Error(`Worker error: ${e.message}`));
        };

        worker.postMessage({ file, type });
    });
};

// --- EXPORT FUNCTIONS ---

/**
 * Calculates the optimal column widths for an array-of-arrays data set.
 * @param data The 2D array of data (e.g., from an order).
 * @returns An array of width objects for SheetJS {wch: number}.
 */
const getAutoColumnWidths = (data: any[][]): { wch: number }[] => {
    if (!data || data.length === 0) return [];
    
    const colWidths: number[] = [];

    data.forEach(row => {
        row.forEach((cell, colIndex) => {
            const cellValue = cell ?? '';
            const cellLength = String(cellValue).length;
            colWidths[colIndex] = Math.max(colWidths[colIndex] || 0, cellLength);
        });
    });
    
    // Add padding. Give more to barcode and name columns.
    return colWidths.map((width, index) => {
        let padding = 3;
        if (index === 0) padding = 5; // 바코드
        if (index === 1) padding = 5; // 품명
        if (index === 3) padding = 5; // 단위
        return { wch: width + padding };
    });
};


export const exportToSMS = (order: Order): string => {
    if (!order.items) return '경진마트\n(품목 정보 없음)';
    const itemsBody = order.items.map(item => {
        const memoText = item.memo ? `(${item.memo})` : '';
        // 일부 SMS 앱에서 '&' 문자를 처리하지 못하는 문제를 해결하기 위해
        // 일반 앰퍼샌드를 전각 앰퍼샌드('＆')로 대체합니다.
        // 이는 시각적으로 유사하지만 URI에서 특수 문자로 처리되지 않습니다.
        const safeName = item.name.replace(/&/g, '＆');
        return `${safeName} ${item.quantity}${item.unit}${memoText}`;
    }).join('\n');

    return `경진마트\n${itemsBody}`;
};

export const exportToXLS = async (order: Order, deliveryType: '일반배송' | '택배배송') => {
    try {
        await loadScript(XLSX_CDN);
    } catch (error) {
        console.error("Failed to load XLSX library for export", error);
        alert("엑셀 내보내기 라이브러리를 로드하는 데 실패했습니다. 인터넷 연결을 확인해주세요.");
        return;
    }

    const fileName = `발주서_${order.customer.name}_${new Date().toISOString().slice(0, 10)}.xls`;

    // --- Default Export Logic ---
    const workbook = XLSX.utils.book_new();

    const itemData: (string | number | null)[][] = [];
    const CHUNK_SIZE = 10;
    
    if (order.items) {
        order.items.forEach((item, index) => {
            if (index > 0 && index % CHUNK_SIZE === 0) {
                itemData.push([null, null, null, null]);
            }
            itemData.push([
                item.barcode,
                item.name,
                item.quantity,
                `${item.unit}${item.memo ? ` (${item.memo})` : ''}`,
            ]);
        });
    }


    const dataForSheet: (string | number | null)[][] = [
        [], // Row 1
        [], // Row 2
        ['경진마트발주서'], // Row 3
        [], // Row 4
        [], // Row 5
        ['발주일자:', new Date(order.date).toLocaleDateString('ko-KR')], // Row 6
        [], // Row 7
        ['바코드', '품명', '수량', '단위'], // Row 8
        ...itemData
    ];

    if (deliveryType === '택배배송') {
        dataForSheet.push([]);
        dataForSheet.push(['택배로보내주세요']);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(dataForSheet);

    const merges = [
        { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } }
    ];
    if (deliveryType === '택배배송') {
        const footerRowIndex = dataForSheet.length - 1;
        merges.push({ s: { r: footerRowIndex, c: 0 }, e: { r: footerRowIndex, c: 3 } });
    }
    worksheet['!merges'] = merges;

    const tableDataForWidths = [
        ['바코드', '품명', '수량', '단위'],
        ...itemData
    ];
    worksheet['!cols'] = getAutoColumnWidths(tableDataForWidths);

    const titleCell = worksheet[XLSX.utils.encode_cell({ r: 2, c: 0 })];
    if (titleCell) {
        titleCell.s = {
            font: { sz: 20, bold: true },
            alignment: { horizontal: 'center', vertical: 'center' }
        };
    }

    const tableHeaderRow = 7;
    for (let col = 0; col < 4; col++) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: tableHeaderRow, c: col })];
        if (cell) {
            cell.s = {
                font: { color: { rgb: "FFFFFF" }, bold: true, sz: 12 },
                fill: { fgColor: { rgb: "000000" } },
                alignment: { horizontal: 'center', vertical: 'center' }
            };
        }
    }

    const dataStartRow = 8;
    for (let i = 0; i < itemData.length; i++) {
        const row = dataStartRow + i;
        for (let col = 0; col < 4; col++) {
            const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
            if (cell) {
                if (!cell.s) cell.s = {};
                cell.s.font = { sz: 12 };
                if (col === 2) { // 수량 column
                    cell.s.font.bold = true;
                }
                 if (col === 3) { // 단위 column, left-align
                    if (!cell.s.alignment) cell.s.alignment = {};
                    cell.s.alignment.horizontal = 'left';
                }
            }
        }
    }

    if (deliveryType === '택배배송') {
        const footerRowIndex = dataForSheet.length - 1;
        const footerCell = worksheet[XLSX.utils.encode_cell({ r: footerRowIndex, c: 0 })];
        if (footerCell) {
            footerCell.s = {
                font: { sz: 25, bold: true },
                alignment: { horizontal: 'center', vertical: 'center' }
            };
        }
    }
    
    XLSX.utils.book_append_sheet(workbook, worksheet, "발주서");
    XLSX.writeFile(workbook, fileName);
};

export const exportReturnToPDF = async (order: Order) => {
    try {
        await Promise.all([loadScript(JSPDF_CDN), loadScript(JSBARCODE_CDN)]);
        
        const fontResponse = await fetch('/fonts/NanumGothic-Regular.ttf');
        if (!fontResponse.ok) {
            throw new Error('나눔고딕 폰트 파일을 불러오는 데 실패했습니다. public/fonts/ 폴더에 파일이 있는지 확인해주세요.');
        }
        const fontBuffer = await fontResponse.arrayBuffer();

        const fontBase64 = btoa(
            new Uint8Array(fontBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        if (!order.items || order.items.length === 0) {
            alert("내보낼 품목이 없습니다.");
            return;
        }
    
        const { jsPDF } = (window as any).jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');

        doc.addFileToVFS('NanumGothic-Regular.ttf', fontBase64);
        doc.addFont('NanumGothic-Regular.ttf', 'NanumGothic', 'normal');
        doc.setFont('NanumGothic');

        const PAGE_WIDTH = doc.internal.pageSize.getWidth();
        const PAGE_HEIGHT = doc.internal.pageSize.getHeight();
        const MARGIN = 10;
        const HEADER_HEIGHT = 20;
        const FOOTER_HEIGHT = 10;
        const MAX_WIDTH = PAGE_WIDTH - MARGIN * 2;
        const COL_COUNT = 3;
        const COL_GAP = 7;
        const COL_WIDTH = (MAX_WIDTH - (COL_GAP * (COL_COUNT - 1))) / COL_COUNT;
        const ITEM_BLOCK_HEIGHT = 27;

        // --- 1. Pre-computation Phase: Group items into pages and calculate page totals ---
        const pages: { items: OrderItem[], total: number }[] = [];
        let currentPageItems: OrderItem[] = [];
        let currentPageTotal = 0;
        let yPos = MARGIN + HEADER_HEIGHT + 2;
        let colIndex = 0;
        
        for (const item of order.items) {
            if (yPos + ITEM_BLOCK_HEIGHT > PAGE_HEIGHT - MARGIN - FOOTER_HEIGHT) {
                colIndex++;
                yPos = MARGIN + HEADER_HEIGHT + 2;

                if (colIndex >= COL_COUNT) {
                    pages.push({ items: currentPageItems, total: currentPageTotal });
                    currentPageItems = [];
                    currentPageTotal = 0;
                    colIndex = 0;
                }
            }
            currentPageItems.push(item);
            currentPageTotal += (item.price * item.quantity);
            yPos += ITEM_BLOCK_HEIGHT;
        }

        if (currentPageItems.length > 0) {
            pages.push({ items: currentPageItems, total: currentPageTotal });
        }
        const totalPages = pages.length;

        // --- 2. Drawing Phase ---
        pages.forEach((page, pageIndex) => {
            if (pageIndex > 0) {
                doc.addPage();
            }

            // --- Render Header ---
            doc.setFontSize(22);
            doc.setFont('NanumGothic', 'normal');
            doc.text('경진마트반품', PAGE_WIDTH / 2, MARGIN + 8, { align: 'center' });
            doc.setFontSize(10);
            const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
            doc.text(`날짜: ${today}`, MARGIN, MARGIN + 12);
            doc.text(`거래처: ${order.customer.name}`, MARGIN, MARGIN + 16);
            
            let totalText;
            if (pageIndex === 0 && totalPages > 1) {
                totalText = `페이지 합계: ${page.total.toLocaleString('ko-KR')} 원 / 총 합계: ${order.total.toLocaleString('ko-KR')} 원`;
            } else if (totalPages > 1) {
                 totalText = `페이지 합계: ${page.total.toLocaleString('ko-KR')} 원`;
            } else {
                 totalText = `합계: ${order.total.toLocaleString('ko-KR')} 원`;
            }
            doc.text(totalText, PAGE_WIDTH - MARGIN, MARGIN + 16, { align: 'right' });
            
            doc.setDrawColor(100, 100, 100);
            doc.setLineWidth(0.2);
            doc.line(MARGIN, MARGIN + HEADER_HEIGHT - 2, PAGE_WIDTH - MARGIN, MARGIN + HEADER_HEIGHT - 2);

            // --- Render Items for the current page ---
            let x = MARGIN;
            let y = MARGIN + HEADER_HEIGHT + 2;
            let currentColumn = 0;
            
            for (const item of page.items) {
                 if (y + ITEM_BLOCK_HEIGHT > PAGE_HEIGHT - MARGIN - FOOTER_HEIGHT) {
                    currentColumn++;
                    x += COL_WIDTH + COL_GAP;
                    y = MARGIN + HEADER_HEIGHT + 2;
                }
                
                const startOfBlockY = y;

                // Pre-calculate barcode position to align quantity text
                const canvas = document.createElement('canvas');
                const barcodeHeight = 8;
                let barcodeWidth = COL_WIDTH; // Default width
                let barcodeDataUrl = '';
                let hasBarcodeError = false;
                try {
                    JsBarcode(canvas, item.barcode, { format: "CODE128", width: 1.5, height: 40, displayValue: false, margin: 0 });
                    barcodeDataUrl = canvas.toDataURL('image/png');
                    barcodeWidth = (barcodeHeight / canvas.height) * canvas.width;
                } catch (e) {
                    hasBarcodeError = true;
                    console.error(`JsBarcode error for ${item.barcode}:`, e);
                }
                const finalBarcodeWidth = Math.min(barcodeWidth, COL_WIDTH);
                const centeredBarcodeX = x + (COL_WIDTH - finalBarcodeWidth) / 2;

                // 1. Product Name
                y += 4; 
                doc.setFontSize(11);
                doc.setFont('NanumGothic', 'normal');
                const productName = doc.splitTextToSize(item.name, COL_WIDTH)[0];
                doc.text(productName, x, y);
                
                // 2. Details line (Qty, Unit Price, Total Price)
                y += 4;
                doc.setFontSize(9);
                doc.text(String(item.quantity), centeredBarcodeX, y);
                doc.text(item.price.toLocaleString(), x + COL_WIDTH / 2, y, { align: 'center' });
                doc.text((item.price * item.quantity).toLocaleString(), x + COL_WIDTH, y, { align: 'right' });
                
                // 3. Barcode Image
                y += 1.5;
                if (!hasBarcodeError) {
                    doc.addImage(barcodeDataUrl, 'PNG', centeredBarcodeX, y, finalBarcodeWidth, barcodeHeight);
                } else {
                    doc.setFontSize(8);
                    doc.text('[바코드 오류]', x + COL_WIDTH / 2, y + 4, { align: 'center' });
                }
                y += barcodeHeight;
                
                // 4. Barcode Number (below image)
                y += 3;
                doc.setFontSize(9);
                doc.text(item.barcode, x + COL_WIDTH / 2, y, { align: 'center' });
                
                // 5. Dotted Separator Line
                const separatorY = startOfBlockY + ITEM_BLOCK_HEIGHT - 2;
                doc.setDrawColor(200, 200, 200);
                doc.setLineDashPattern([1, 1], 0);
                doc.line(x, separatorY, x + COL_WIDTH, separatorY);
                doc.setLineDashPattern([], 0);

                y = startOfBlockY + ITEM_BLOCK_HEIGHT;
            }
        });

        // --- 3. Add page numbers to all pages ---
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFont('NanumGothic', 'normal');
            doc.setFontSize(9);
            doc.text(`- ${i} / ${totalPages} -`, PAGE_WIDTH / 2, PAGE_HEIGHT - 7, { align: 'center' });
        }

        const fileName = `반품서_${order.customer.name}_${new Date().toISOString().slice(0, 10)}.pdf`;
        doc.save(fileName);

    } catch (error) {
        console.error("PDF 생성 중 오류 발생:", error);
        alert(`PDF 내보내기에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`);
    }
};