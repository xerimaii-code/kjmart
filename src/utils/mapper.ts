// src/utils/mapper.ts
import { Product } from '../types';

export const sanitizeString = (str: any): string => {
    if (str === null || str === undefined) return '';
    // Removes control characters but preserves whitespace like space, tab, newline.
    return String(str).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "").trim();
};

export const formatDateFromSQL = (dateValue: any): string | undefined => {
    if (!dateValue) return undefined;
    try {
        let d: Date;
        if (dateValue instanceof Date) {
            d = dateValue;
        } else {
            // Handle 'YYYY-MM-DDTHH:mm:ss.sssZ' or 'YYYY-MM-DD' formats
            const dateStr = String(dateValue).split('T')[0].replace(/-/g, '/');
            d = new Date(dateStr);
        }
        if (isNaN(d.getTime())) return undefined;

        const year = d.getFullYear();
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const day = d.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch (e) {
        return undefined;
    }
};

export const mapSqlResultToProduct = (p: any): Product => ({
    barcode: sanitizeString(p.바코드 || ''),
    name: sanitizeString(p.상품명 || ''),
    costPrice: p.매입가 ?? 0,
    sellingPrice: p.판매가 ?? 0,
    eventCostPrice: p.행사매입가 ? p.행사매입가 : undefined,
    salePrice: p.행사판매가 ? p.행사판매가 : undefined,
    saleStartDate: formatDateFromSQL(p.행사시작일),
    saleEndDate: formatDateFromSQL(p.행사종료일),
    supplierName: sanitizeString(p.거래처명) || undefined,
    lastModified: p.최종수정일 || undefined,
    stockQuantity: p.재고수량 !== null && p.재고수량 !== undefined ? parseFloat(String(p.재고수량)) : undefined,
});
