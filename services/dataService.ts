import { Customer, Order, Product } from "../types";

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


interface ProcessResult<T> {
    valid: T[];
    invalidCount: number;
    errors: string[];
}

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
        return { wch: width + padding };
    });
};


/**
 * Applies styles to a range of cells in a worksheet.
 * @param worksheet The SheetJS worksheet object.
 * @param startRow The starting row index.
 * @param endRow The ending row index.
 * @param startCol The starting column index.
 * @param quantityColIndex The absolute column index for the '수량' column.
 */
const applyCellStyles = (worksheet: any, startRow: number, endRow: number, startCol: number, endCol: number, quantityColIndex: number) => {
    for (let R = startRow; R <= endRow; ++R) {
        for (let C = startCol; C <= endCol; ++C) {
            const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
            if (!worksheet[cellAddress]) continue; // Skip empty cells

            const cell = worksheet[cellAddress];
            
            // Ensure style object exists
            if (!cell.s) cell.s = {};
            if (!cell.s.font) cell.s.font = {};

            // Set font size to 12
            cell.s.font.sz = "12";
            
            // Make "수량" column bold
            if (C === quantityColIndex) { 
                cell.s.font.bold = true;
            }
        }
    }
};


// --- FILE PARSING ---

export const parseExcelFile = (file: File | Blob): Promise<any[]> => {
    return new Promise(async (resolve, reject) => {
        try {
            await loadScript(XLSX_CDN);
        } catch (error) {
            return reject(new Error("엑셀 라이브러리를 로드하는 데 실패했습니다."));
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                if (!e.target?.result) {
                    throw new Error("파일을 읽을 수 없습니다.");
                }
                const data = new Uint8Array(e.target.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                
                if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
                    throw new Error("엑셀 파일에서 시트를 찾을 수 없습니다.");
                }

                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                if (json.length < 2) {
                    // Empty sheet or header-only sheet
                    return resolve([]);
                }
                resolve(json.slice(1)); // Return rows, excluding header
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
};

const isValidFirebaseKey = (key: string): boolean => {
    if (!key) return false;
    // Firebase keys must not contain '.', '$', '#', '[', ']', or '/'
    return !/[.#$[\]/]/.test(key);
};

export const processCustomerData = (rows: any[]): ProcessResult<Customer> => {
    const valid: Customer[] = [];
    const errors: string[] = [];

    rows.forEach((row, index) => {
        const comcode = String(row[0] || '').trim();
        const name = String(row[1] || '').trim();

        if (!comcode) {
            errors.push(`${index + 2}행: 거래처 코드 필드가 비어있습니다.`);
            return;
        }
        if (!isValidFirebaseKey(comcode)) {
            errors.push(`${index + 2}행: 거래처 코드에 유효하지 않은 문자(. # $ [ ] /)가 포함되어 있습니다: '${comcode}'`);
            return;
        }
        if (!name) {
            errors.push(`${index + 2}행: 거래처명 필드가 비어있습니다.`);
            return;
        }

        valid.push({ comcode, name });
    });

    return {
        valid,
        invalidCount: errors.length,
        errors,
    };
};

export const processProductData = (rows: any[]): ProcessResult<Product> => {
    const valid: Product[] = [];
    const errors: string[] = [];
    
    rows.forEach((row, index) => {
        const barcode = String(row[0] || '').trim();
        const name = String(row[1] || '').trim();
        const price = parseFloat(String(row[2]));

        if (!barcode) {
            errors.push(`${index + 2}행: 바코드 필드가 비어있습니다.`);
            return;
        }
        if (!isValidFirebaseKey(barcode)) {
            errors.push(`${index + 2}행: 바코드에 유효하지 않은 문자(. # $ [ ] /)가 포함되어 있습니다: '${barcode}'`);
            return;
        }
        if (!name) {
            errors.push(`${index + 2}행: 품명 필드가 비어있습니다.`);
            return;
        }

        valid.push({
            barcode,
            name,
            price: isNaN(price) ? 0 : price,
        });
    });

    return {
        valid,
        invalidCount: errors.length,
        errors,
    };
};


// --- EXPORT FUNCTIONS ---

// Helper function to convert base64 to ArrayBuffer
const base64ToArrayBuffer = (base64: string) => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
};


export const exportToSMS = (order: Order): string => {
    const title = '경진마트';
    const customerName = `거래처: ${order.customer.name}`;
    const orderDate = `발주일: ${new Date(order.date).toLocaleDateString('ko-KR')}`;

    const itemsBody = order.items.map(item => {
        const promotionText = item.isPromotion ? '(행사)' : '';
        return `${promotionText}${item.name}/${item.quantity}${item.unit}`;
    }).join('\n');

    const totalAmount = `총액: ${order.total.toLocaleString()}원`;

    const fullMessage = `${title}\n${customerName}\n${orderDate}\n\n${itemsBody}\n\n${totalAmount}`;
    return fullMessage;
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
    order.items.forEach((item, index) => {
        itemData.push([
            item.barcode,
            `${item.isPromotion ? '(행사)' : ''}${item.name}`,
            item.quantity,
            item.unit
        ]);
        // 마지막 아이템 뒤에는 빈 행을 추가하지 않음
        if ((index + 1) % 5 === 0 && (index + 1) < order.items.length) {
            itemData.push([null, null, null, null]);
        }
    });

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
                if (col === 2) {
                    cell.s.font.bold = true;
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