import { Order } from '../types';

declare const XLSX: any; // Using XLSX from CDN

export const parseExcelFile = (file: File): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet);
        resolve(json);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
};

export const generateXLS = (order: Order) => {
    const data: any[] = order.items.map(item => ({
        '거래처명': order.customer.name,
        '발주일': new Date(order.date).toLocaleDateString('ko-KR'),
        '바코드': item.barcode,
        '품명': `${item.isPromotion ? '(행사) ' : ''}${item.name}`,
        '단가': item.price,
        '수량': item.quantity,
        '단위': item.unit,
        '공급가액': item.price * item.quantity,
    }));

    const totalRow = {
        '거래처명': '',
        '발주일': '',
        '바코드': '',
        '품명': '',
        '단가': '',
        '수량': '총 합계',
        '단위': '',
        '공급가액': order.total,
    };
    data.push(totalRow);

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '발주내역');

    // 컬럼 너비 설정
    const colWidths = [
        { wch: 20 }, // 거래처명
        { wch: 12 }, // 발주일
        { wch: 15 }, // 바코드
        { wch: 30 }, // 품명
        { wch: 10 }, // 단가
        { wch: 8 },  // 수량
        { wch: 8 },  // 단위
        { wch: 12 }, // 공급가액
    ];
    worksheet['!cols'] = colWidths;

    XLSX.writeFile(workbook, `${order.customer.name}_${new Date(order.date).toISOString().slice(0,10)}.xlsx`);
};

export const formatSmsBody = (order: Order): string => {
  const dateStr = new Date(order.date).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
  let body = `[${order.customer.name} ${dateStr} 발주]\n`;
  
  order.items.forEach(item => {
    const itemName = `${item.isPromotion ? '(행)' : ''}${item.name}`;
    body += `${itemName} ${item.quantity}${item.unit}\n`;
  });
  
  body += `\n총 ${order.items.length}품목 / ${order.total.toLocaleString()}원`;
  
  return encodeURIComponent(body);
};
