import { Customer, Order, Product } from "../types.ts";
import { nanumGothicFontBase64 } from '../assets/NanumGothicFont.ts';

// Assuming these libraries are loaded from CDN
declare const XLSX: any;
declare const jsPDF: any;

// --- FILE PARSING ---

export const parseExcelFile = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                if (!e.target?.result) {
                    throw new Error("File could not be read.");
                }
                const data = new Uint8Array(e.target.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                if (json.length < 2) {
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

export const processCustomerData = (rows: any[]): Customer[] => {
    return rows.map(row => ({
        comcode: String(row[0] || ''),
        name: String(row[1] || ''),
    })).filter(c => c.comcode && c.name);
};

export const processProductData = (rows: any[]): Product[] => {
    return rows.map(row => ({
        barcode: String(row[0] || ''),
        name: String(row[1] || ''),
        price: parseFloat(String(row[2])) || 0,
    })).filter(p => p.barcode && p.name);
};


// --- EXPORT FUNCTIONS ---

export const exportToSMS = (order: Order) => {
    const title = "경진마트발주";
    const body = order.items.map(item => `${item.isPromotion ? '(행사)' : ''}${item.name}/${item.quantity}${item.unit}`).join('\n');
    const smsLink = `sms:?body=${encodeURIComponent(title + '\n' + body)}`;
    window.location.href = smsLink;
};

export const exportToXLS = (order: Order) => {
    const data = order.items.map(item => ({
        '바코드': item.barcode,
        '품명': `${item.isPromotion ? '(행사)' : ''}${item.name}`,
        '단가': item.price,
        '발주수량': item.quantity,
        '단위': item.unit,
        '금액': item.price * item.quantity
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "발주내역");
    XLSX.writeFile(workbook, `발주서_${order.customer.name}_${new Date().toISOString().slice(0,10)}.xls`);
};

export const exportToPDF = (order: Order) => {
    try {
        // FIX: Cast window to `any` to access the jspdf property injected by the CDN script, resolving the TypeScript error.
        const { jsPDF } = (window as any).jspdf;
        const doc = new jsPDF();

        // Add Korean font
        doc.addFileToVFS('NanumGothic-Regular.ttf', nanumGothicFontBase64);
        doc.addFont('NanumGothic-Regular.ttf', 'NanumGothic', 'normal');
        doc.setFont('NanumGothic');

        // Header
        doc.setFontSize(22);
        doc.text("발 주 서", 105, 20, { align: 'center' });

        // Order Info
        doc.setFontSize(12);
        doc.text(`거래처: ${order.customer.name}`, 20, 40);
        doc.text(`발주일: ${new Date(order.date).toLocaleDateString('ko-KR')}`, 190, 40, { align: 'right' });

        // Table
        const tableColumn = ["품명", "단가", "수량", "단위", "금액"];
        const tableRows: (string|number)[][] = [];

        order.items.forEach(item => {
            const itemData = [
                `${item.isPromotion ? '(행사) ' : ''}${item.name}`,
                item.price.toLocaleString(),
                item.quantity,
                item.unit,
                (item.price * item.quantity).toLocaleString()
            ];
            tableRows.push(itemData);
        });

        (doc as any).autoTable({
            startY: 50,
            head: [tableColumn],
            body: tableRows,
            theme: 'grid',
            styles: {
                font: 'NanumGothic',
                halign: 'center'
            },
            headStyles: {
                fillColor: [30, 144, 255], // sky-500 color
                textColor: 255,
                fontStyle: 'bold'
            },
            columnStyles: {
                0: { halign: 'left' },
                1: { halign: 'right' },
                4: { halign: 'right' }
            }
        });

        // Total
        const finalY = (doc as any).lastAutoTable.finalY;
        doc.setFontSize(14);
        doc.setFont('NanumGothic', 'bold');
        doc.text(`총 합계: ${order.total.toLocaleString()} 원`, 190, finalY + 15, { align: 'right' });

        // Save
        doc.save(`발주서_${order.customer.name}_${new Date().toISOString().slice(0,10)}.pdf`);

    } catch (error) {
        console.error("PDF export failed:", error);
        alert("PDF 파일 생성에 실패했습니다.");
    }
};