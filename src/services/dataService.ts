import { Customer, Order, Product, OrderItem } from "../types";

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


// --- PDF 한글 폰트 처리 ---

export const exportReturnToPDF = async (order: any): Promise<{ file: File, blobUrl: string }> => {
    try {
        // 라이브러리 로드 (loadScript 함수가 파일 내에 있어야 합니다)
        await Promise.all([loadScript(JSPDF_CDN), loadScript(JSBARCODE_CDN)]);
        
        // 폰트 로딩
        const fontBase64 = await loadKoreanFontForPdf();

        if (!order.items || order.items.length === 0) {
            throw new Error("내보낼 품목이 없습니다.");
        }
    
        const { jsPDF } = (window as any).jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');

        // 한글 폰트 등록
        const FONT_VFS_NAME = 'NanumGothic-Regular.ttf';
        const FONT_NAME_JS_PDF = 'NanumGothic';

        doc.addFileToVFS(FONT_VFS_NAME, fontBase64);
        doc.addFont(FONT_VFS_NAME, FONT_NAME_JS_PDF, 'normal');
        doc.setFont(FONT_NAME_JS_PDF);

        // 페이지 규격 및 레이아웃 설정
        const PAGE_WIDTH = doc.internal.pageSize.getWidth();
        const PAGE_HEIGHT = doc.internal.pageSize.getHeight();
        const MARGIN = 10;
        const HEADER_HEIGHT = 22;
        const FOOTER_HEIGHT = 10;
        const MAX_WIDTH = PAGE_WIDTH - MARGIN * 2;
        
        // 3단 그리드 설정 (이 부분이 레이아웃의 핵심입니다)
        const COL_COUNT = 3;
        const COL_GAP = 7;
        const COL_WIDTH = (MAX_WIDTH - (COL_GAP * (COL_COUNT - 1))) / COL_COUNT;
        const ITEM_BLOCK_HEIGHT = 27;

        // [1단계] 페이지 계산: 아이템을 페이지별로 미리 나눕니다.
        const pages = [];
        let currentPageItems = [];
        let currentPageTotal = 0;
        let yPos = MARGIN + HEADER_HEIGHT + 2;
        let colIndex = 0;
        
        for (const item of order.items) {
            // 세로 공간이 부족하면 다음 열(Column)로 이동
            if (yPos + ITEM_BLOCK_HEIGHT > PAGE_HEIGHT - MARGIN - FOOTER_HEIGHT) {
                colIndex++;
                yPos = MARGIN + HEADER_HEIGHT + 2;

                // 3번째 열까지 꽉 차면 다음 페이지로
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

        // [2단계] 그리기 (Drawing)
        pages.forEach((page: { items: any[], total: number }, pageIndex: number) => {
            if (pageIndex > 0) doc.addPage();

            // 헤더 출력
            doc.setFontSize(22);
            doc.text('경진마트반품', PAGE_WIDTH / 2, MARGIN + 8, { align: 'center' });
            doc.setFontSize(10);
            const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
            doc.text(`날짜: ${today}`, MARGIN, MARGIN + HEADER_HEIGHT - 5);
            doc.text(`거래처: ${order.customer.name}`, PAGE_WIDTH - MARGIN, MARGIN + HEADER_HEIGHT - 5, { align: 'right' });

            // 구분선 (Divider)
            doc.setLineWidth(0.5);
            doc.line(MARGIN, MARGIN + HEADER_HEIGHT, PAGE_WIDTH - MARGIN, MARGIN + HEADER_HEIGHT);

            // 아이템 출력 (Items output)
            let currentY = MARGIN + HEADER_HEIGHT + 2;
            let currentColumn = 0;

            page.items.forEach((item: any) => {
                const xPos = MARGIN + (currentColumn * (COL_WIDTH + COL_GAP));
                
                // 아이템 박스 (Item Box)
                doc.setDrawColor(200);
                doc.rect(xPos, currentY, COL_WIDTH, ITEM_BLOCK_HEIGHT);
                doc.setDrawColor(0); // Reset to black

                // 바코드 (Barcode)
                try {
                     const canvas = document.createElement('canvas');
                     JsBarcode(canvas, item.barcode, {
                         format: "EAN13",
                         displayValue: false,
                         margin: 0,
                         height: 20,
                         width: 1.5,
                         fontSize: 0
                     });
                     const barcodeDataUrl = canvas.toDataURL("image/png");
                     doc.addImage(barcodeDataUrl, 'PNG', xPos + 2, currentY + 2, 25, 8);
                     doc.setFontSize(7);
                     doc.text(item.barcode, xPos + 2, currentY + 13);
                } catch (e) {
                    doc.setFontSize(8);
                    doc.text(item.barcode, xPos + 2, currentY + 8);
                }

                // 품명 (Product Name)
                doc.setFontSize(8);
                doc.setFont(FONT_NAME_JS_PDF, 'normal');
                const name = item.name.length > 18 ? item.name.substring(0, 17) + '...' : item.name;
                doc.text(name, xPos + 2, currentY + 17);

                // 수량 (Quantity)
                doc.setFontSize(11);
                doc.setFont(FONT_NAME_JS_PDF, 'bold');
                doc.text(`${item.quantity}${item.unit}`, xPos + COL_WIDTH - 2, currentY + 10, { align: 'right' });
                
                // 가격 (Price)
                doc.setFontSize(9);
                doc.setFont(FONT_NAME_JS_PDF, 'normal');
                doc.text(`${item.price.toLocaleString()}원`, xPos + COL_WIDTH - 2, currentY + 24, { align: 'right' });
                
                // 메모 (Memo)
                if (item.memo) {
                    doc.setFontSize(7);
                    doc.setTextColor(100);
                    doc.text(`(${item.memo})`, xPos + 2, currentY + 24);
                    doc.setTextColor(0);
                }

                // 위치 업데이트 (Update position for next item within the page)
                currentY += ITEM_BLOCK_HEIGHT;
                if (currentY + ITEM_BLOCK_HEIGHT > PAGE_HEIGHT - MARGIN - FOOTER_HEIGHT) {
                    currentY = MARGIN + HEADER_HEIGHT + 2;
                    currentColumn++;
                }
            });

            // 페이지 하단 합계 (Page Footer Total)
            const footerY = PAGE_HEIGHT - MARGIN + 5;
            doc.setFontSize(10);
            doc.text(`페이지 소계: ${page.total.toLocaleString()}원`, PAGE_WIDTH - MARGIN, footerY, { align: 'right' });
            doc.text(`${pageIndex + 1} / ${totalPages}`, PAGE_WIDTH / 2, footerY, { align: 'center' });
        });

        // PDF 생성
        const pdfBlob = doc.output('blob');
        const fileName = `반품서_${order.customer.name}_${new Date().toISOString().slice(0, 10)}.pdf`;
        const file = new File([pdfBlob], fileName, { type: "application/pdf" });
        const blobUrl = URL.createObjectURL(pdfBlob);

        return { file, blobUrl };

    } catch (error) {
        console.error("PDF Export Error:", error);
        throw error; // 에러를 다시 던져서 호출자가 처리하도록 함
    }
};