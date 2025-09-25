
import { Customer, Order, Product } from "../types";

// Assuming these libraries are loaded from CDN
declare const XLSX: any;
declare const jspdf: any;

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
    const body = order.items.map(item => `${item.name}/${item.quantity}${item.unit}`).join('\n');
    const smsLink = `sms:?body=${encodeURIComponent(title + '\n' + body)}`;
    window.location.href = smsLink;
};

export const exportToXLS = (order: Order) => {
    const data = order.items.map(item => ({
        '바코드': item.barcode,
        '품명': item.name,
        '단가': item.price,
        '발주수량': item.quantity,
        '단위': item.unit,
        '금액': item.price * item.quantity
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "발주내역");
    XLSX.writeFile(workbook, `발주서_${order.customer.name}_${new Date().toISOString().slice(0,10)}.xlsx`);
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
};

export const exportToPDF = async (order: Order) => {
    const { jsPDF } = jspdf;
    const doc = new jsPDF();
    
    // Fetch and add Nanum Gothic font for Korean support
    try {
        const fontResponse = await fetch('https://fonts.gstatic.com/s/nanumgothic/v17/PN_3Rfi-oZ3f2eTy_tvA9gh-8fQ.woff');
        if (!fontResponse.ok) throw new Error('Font not loaded');
        const font = await fontResponse.arrayBuffer();

        doc.addFileToVFS('NanumGothic.ttf', arrayBufferToBase64(font));
        doc.addFont('NanumGothic.ttf', 'NanumGothic', 'normal');
        doc.addFont('NanumGothic.ttf', 'NanumGothic', 'bold');
        
        doc.setFont('NanumGothic', 'bold');
        doc.setFontSize(20);
        doc.text("경진마트 발주서", 105, 20, { align: 'center' });

        doc.setFont('NanumGothic', 'normal');
        doc.setFontSize(12);
        doc.text(`거래처: ${order.customer.name}`, 14, 35);
        doc.text(`발주일자: ${new Date(order.date).toLocaleDateString('ko-KR')}`, 196, 35, { align: 'right' });

        const tableColumn = ["바코드", "품명", "발주수량"];
        const tableRows = order.items.map(item => [
            item.barcode,
            item.name,
            `${item.quantity} ${item.unit}`
        ]);

        (doc as any).autoTable({
            head: [tableColumn],
            body: tableRows,
            startY: 45,
            theme: 'grid',
            styles: {
                font: 'NanumGothic',
                fontStyle: 'normal'
            },
            headStyles: {
                fillColor: [22, 160, 133],
                textColor: 255,
                fontStyle: 'bold'
            },
            columnStyles: {
                0: { halign: 'center' },
                2: { halign: 'left' }
            }
        });

        doc.save(`발주서_${order.customer.name}_${new Date().toISOString().slice(0,10)}.pdf`);

    } catch (error) {
        console.error("PDF Export Error:", error);
        alert("PDF 생성에 실패했습니다. 폰트를 불러올 수 없습니다.");
    }
};
