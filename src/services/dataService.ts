
import { Customer, Order, Product, OrderItem } from "../types";
import { Capacitor } from '@capacitor/core';
import { saveFileNatively } from './nativeFileService';

// Assuming these libraries are loaded from CDN
declare const XLSX: any;
declare const jsPDF: any;
declare const JsBarcode: any;

const loadedScripts: { [src: string]: Promise<void> } = {};

// Define constants once at the top level
const XLSX_CDN = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
const JSPDF_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
const JSBARCODE_CDN = "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js";
const KOREAN_FONT_URL = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Regular.ttf';

let koreanFontBase64: string | null = null;

// 한글 폰트를 가져와서 Base64로 변환하는 함수 (필수)
async function loadKoreanFontForPdf(): Promise<string> {
    if (koreanFontBase64) {
        return koreanFontBase64;
    }

    try {
        const fontResponse = await fetch(KOREAN_FONT_URL);
        if (!fontResponse.ok) {
            throw new Error(`Font fetch failed with status: ${fontResponse.status}`);
        }
        const fontBuffer = await fontResponse.arrayBuffer();

        const base64 = btoa(
            new Uint8Array(fontBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        koreanFontBase64 = base64;
        return base64;
    } catch (error) {
        console.error("Critical: Could not load Korean font for PDF export.", error);
        throw new Error('PDF 생성에 필요한 한글 폰트를 불러올 수 없습니다. 인터넷 연결을 확인해주세요.');
    }
}


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
        // 일부 SMS 앱에서 '&'와 '()' 문자를 처리하지 못하는 문제를 해결하기 위해
        // URI 인코딩 전 안전한 문자로 대체하거나 제거합니다.
        const safeName = item.name
            .replace(/&/g, '＆') // 전각 앰퍼샌드로 변경
            .replace(/[()]/g, '');   // 괄호 제거
        return `${safeName} ${item.quantity}${item.unit}${memoText}`;
    }).join('\n');

    return `경진마트\n${itemsBody}`;
};

export const exportToXLS = async (order: Order, deliveryType: '일반배송' | '택배배송') => {
    try {
        await loadScript(XLSX_CDN);
    } catch (error) {
        console.error("Failed to load XLSX library for export", error);
        throw new Error("엑셀 내보내기 라이브러리를 로드하는 데 실패했습니다. 인터넷 연결을 확인해주세요.");
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

    // [MODIFIED] Platform-specific file saving
    if (Capacitor.isNativePlatform()) {
        const wbout = XLSX.write(workbook, { bookType: 'biff8', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/vnd.ms-excel' });
        // Direct Save (Permissions handled inside saveFileNatively)
        try {
            await saveFileNatively(blob, fileName);
        } catch(e: any) {
            throw e;
        }
    } else {
        XLSX.writeFile(workbook, fileName);
    }
};


// --- PDF 한글 폰트 처리 ---

export const exportReturnToPDF = async (order: Order): Promise<{ file: File, blobUrl: string }> => {
    try {
        // 필수 라이브러리 및 폰트 로드
        await Promise.all([loadScript(JSPDF_CDN), loadScript(JSBARCODE_CDN)]);
        const fontBase64 = await loadKoreanFontForPdf();

        if (!order.items || order.items.length === 0) {
            throw new Error("내보낼 품목이 없습니다.");
        }
    
        // jsPDF 인스턴스 생성 및 폰트 설정
        const { jsPDF } = (window as any).jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        const FONT_VFS_NAME = 'NanumGothic-Regular.ttf';
        const FONT_NAME_JS_PDF = 'NanumGothic';
        doc.addFileToVFS(FONT_VFS_NAME, fontBase64);
        doc.addFont(FONT_VFS_NAME, FONT_NAME_JS_PDF, 'normal');
        doc.setFont(FONT_NAME_JS_PDF);

        // 페이지 레이아웃 계산
        const PAGE_WIDTH = doc.internal.pageSize.getWidth();
        const PAGE_HEIGHT = doc.internal.pageSize.getHeight();
        const MARGIN = 10;
        const HEADER_HEIGHT = 22;
        const FOOTER_HEIGHT = 10;
        const DRAW_AREA_TOP = MARGIN + HEADER_HEIGHT;
        const DRAW_AREA_BOTTOM = PAGE_HEIGHT - MARGIN - FOOTER_HEIGHT;
        const DRAW_AREA_HEIGHT = DRAW_AREA_BOTTOM - DRAW_AREA_TOP;
        const COL_COUNT = 3;
        const COL_GAP = 7;
        const COL_WIDTH = (PAGE_WIDTH - MARGIN * 2 - (COL_GAP * (COL_COUNT - 1))) / COL_COUNT;
        const ITEM_BLOCK_HEIGHT = 27;
        const itemsPerColumn = Math.floor(DRAW_AREA_HEIGHT / ITEM_BLOCK_HEIGHT);
        const itemsPerPage = itemsPerColumn * COL_COUNT;
        
        // 전체 품목을 페이지별로 나누기
        const pagesData = [];
        for (let i = 0; i < order.items.length; i += itemsPerPage) {
            const pageItems = order.items.slice(i, i + itemsPerPage);
            const pageTotal = pageItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            pagesData.push({ items: pageItems, total: pageTotal });
        }
        const totalPages = pagesData.length;

        // 각 페이지 그리기
        pagesData.forEach((page, pageIndex) => {
            if (pageIndex > 0) doc.addPage();

            // 헤더
            doc.setFontSize(22);
            doc.text('경진마트반품', PAGE_WIDTH / 2, MARGIN + 8, { align: 'center' });
            doc.setFontSize(10);
            const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
            doc.text(`날짜: ${today}`, MARGIN, MARGIN + 12);
            doc.text(`거래처: ${order.customer.name}`, MARGIN, MARGIN + 18);
            let totalText = `합계: ${order.total.toLocaleString('ko-KR')} 원`;
            if (totalPages > 1) {
                totalText = `페이지 합계: ${page.total.toLocaleString('ko-KR')} 원 / 총 합계: ${order.total.toLocaleString('ko-KR')} 원`;
            }
            doc.text(totalText, PAGE_WIDTH - MARGIN, MARGIN + 18, { align: 'right' });
            doc.setDrawColor(100, 100, 100);
            doc.setLineWidth(0.2);
            doc.line(MARGIN, DRAW_AREA_TOP - 4, PAGE_WIDTH - MARGIN, DRAW_AREA_TOP - 4);

            // 품목 렌더링
            let currentColumn = 0;
            let currentItemInColumn = 0;
            for (const item of page.items) {
                if (currentItemInColumn >= itemsPerColumn) {
                    currentColumn++;
                    currentItemInColumn = 0;
                }
                
                const x = MARGIN + currentColumn * (COL_WIDTH + COL_GAP);
                const y = DRAW_AREA_TOP + currentItemInColumn * ITEM_BLOCK_HEIGHT;

                // 품명
                doc.setFontSize(11);
                doc.setFont(FONT_NAME_JS_PDF, 'normal');
                const productName = doc.splitTextToSize(item.name, COL_WIDTH)[0];
                doc.text(productName, x, y + 4);
                
                // 수량, 단가, 합계
                doc.setFontSize(9);
                doc.text(`${item.quantity.toLocaleString()} x ${item.price.toLocaleString()}원`, x, y + 8.5);
                doc.text(`${(item.price * item.quantity).toLocaleString()}원`, x + COL_WIDTH, y + 8.5, { align: 'right' });
                
                // 바코드 이미지
                const canvas = document.createElement('canvas');
                const barcodeHeight = 8;
                try {
                    JsBarcode(canvas, item.barcode, { format: "CODE128", width: 1.5, height: 40, displayValue: false, margin: 0 });
                    const barcodeDataUrl = canvas.toDataURL('image/png');
                    const barcodeWidth = (barcodeHeight / canvas.height) * canvas.width;
                    const finalBarcodeWidth = Math.min(barcodeWidth, COL_WIDTH);
                    const centeredBarcodeX = x + (COL_WIDTH - finalBarcodeWidth) / 2;
                    doc.addImage(barcodeDataUrl, 'PNG', centeredBarcodeX, y + 12, finalBarcodeWidth, barcodeHeight);
                } catch (e) {
                    console.error(`JsBarcode 오류 for ${item.barcode}:`, e);
                    doc.setFontSize(8);
                    doc.text('[바코드 생성 오류]', x + COL_WIDTH / 2, y + 12 + 4, { align: 'center' });
                }
                
                // 바코드 번호 텍스트
                doc.setFontSize(9);
                doc.text(item.barcode, x + COL_WIDTH / 2, y + 12 + barcodeHeight + 4, { align: 'center' });
                
                // 구분선
                doc.setDrawColor(200, 200, 200);
                doc.setLineDashPattern([1, 1], 0);
                doc.line(x, y + ITEM_BLOCK_HEIGHT - 2, x + COL_WIDTH, y + ITEM_BLOCK_HEIGHT - 2);
                doc.setLineDashPattern([], 0);

                currentItemInColumn++;
            }
        });

        // 모든 페이지에 페이지 번호 추가
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFont(FONT_NAME_JS_PDF, 'normal');
            doc.setFontSize(9);
            doc.text(`- ${i} / ${totalPages} -`, PAGE_WIDTH / 2, PAGE_HEIGHT - 7, { align: 'center' });
        }

        // 결과물 생성
        const fileName = `반품서_${order.customer.name}_${new Date().toISOString().slice(0, 10)}.pdf`;
        const pdfBlob = doc.output('blob');
        const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
        
        // [MODIFIED] Platform-specific file saving
        if (Capacitor.isNativePlatform()) {
            try {
                await saveFileNatively(pdfBlob, fileName);
                return { file, blobUrl: '' };
            } catch (e: any) {
                // Re-throw to be caught by UI
                throw e;
            }
        } else {
            const blobUrl = URL.createObjectURL(file);
            return { file, blobUrl };
        }

    } catch (error) {
        console.error("PDF 생성 중 오류 발생:", error);
        // 사용자에게 보여줄 수 있도록 에러 메시지를 가공하여 throw합니다.
        const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
        throw new Error(`PDF 내보내기에 실패했습니다: ${message}`);
    }
};
