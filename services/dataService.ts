
import { Customer, Order, Product } from "../types";

// Assuming these libraries are loaded from CDN
declare const XLSX: any;
declare const docx: any;

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

export const exportToDOCX = async (order: Order, isParcelDelivery: boolean) => {
    if (typeof docx === 'undefined') {
        alert("DOCX 라이브러리를 불러오는 데 실패했습니다. 잠시 후 다시 시도해주세요.");
        console.error("DOCX library (from CDN) is not available.");
        return;
    }

    const { Document, Packer, Paragraph, TextRun, AlignmentType, SectionType } = docx;

    const titleChildren = [
        new Paragraph({
            style: "titleStyle",
            text: "경진마트 발주서",
        }),
    ];

    if (isParcelDelivery) {
        titleChildren.push(new Paragraph({
            style: "parcelStyle",
            text: "택배로 배송해주세요",
        }));
    } else {
        // Add a blank paragraph for spacing if parcel text isn't there
        titleChildren.push(new Paragraph({ text: "" }));
    }

    const itemParagraphs = order.items.map(item =>
        new Paragraph({
            style: "itemStyle",
            children: [
                new TextRun(`${item.name} `),
                new TextRun({
                    text: String(item.quantity),
                    bold: true,
                }),
                new TextRun(item.unit),
            ],
        })
    );

    const doc = new Document({
        styles: {
            paragraphStyles: [
                {
                    id: "titleStyle",
                    name: "Title Style",
                    basedOn: "Normal",
                    next: "Normal",
                    run: { size: 50, bold: true }, // 25pt
                    paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 240 } },
                },
                {
                    id: "parcelStyle",
                    name: "Parcel Style",
                    basedOn: "Normal",
                    next: "Normal",
                    run: { size: 40 }, // 20pt
                    paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 480 } },
                },
                {
                    id: "itemStyle",
                    name: "Item Style",
                    basedOn: "Normal",
                    next: "Normal",
                    run: { size: 20 }, // 10pt
                    paragraph: { spacing: { line: 360 } }, // 1.5 line spacing for readability
                },
            ],
        },
        sections: [
            { // Section 1: Title (single column)
                children: titleChildren,
            },
            { // Section 2: Items (two columns)
                properties: {
                    type: SectionType.CONTINUOUS,
                    column: {
                        count: 2,
                        space: 720, // Corresponds to 0.5 inches
                        separator: true,
                    },
                },
                children: itemParagraphs,
            }
        ],
    });

    try {
        const blob = await Packer.toBlob(doc);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const today = new Date().toISOString().slice(0, 10);
        link.download = `발주서_${order.customer.name}_${today}.docx`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error("DOCX Export Error:", error);
        alert("DOCX 파일 생성에 실패했습니다.");
    }
};
