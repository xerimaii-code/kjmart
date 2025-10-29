import { Customer, Order, Product, OrderItem } from "../types";

// Assuming these libraries are loaded from CDN
declare const XLSX: any;

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
        return `${item.name}/${item.quantity}${item.unit}${memoText}`;
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