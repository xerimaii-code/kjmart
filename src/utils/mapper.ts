
// src/utils/mapper.ts
import { Product, Customer } from '../types';

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

export const mapSqlResultToProduct = (p: any): Product => {
    // 재고 필드명 불일치 해결 (재고수량 또는 curjago 확인)
    const stockVal = p.재고수량 !== undefined && p.재고수량 !== null ? p.재고수량 : p.curjago;
    
    return {
        barcode: sanitizeString(p.바코드 || p.barcode || ''),
        name: sanitizeString(p.상품명 || p.descr || ''),
        spec: sanitizeString(p.규격 || p.spec || '') || undefined,
        costPrice: Number(p.매입가 ?? p.money0vat ?? 0),
        sellingPrice: Number(p.판매가 ?? p.money1 ?? 0),
        eventCostPrice: p.행사매입가 ? Number(p.행사매입가) : undefined,
        salePrice: p.행사판매가 ? Number(p.행사판매가) : undefined,
        saleName: sanitizeString(p.행사명 || p.salename) || undefined,
        saleStartDate: formatDateFromSQL(p.행사시작일),
        saleEndDate: formatDateFromSQL(p.행사종료일),
        supplierName: sanitizeString(p.거래처명) || undefined,
        // [수정] 증분 동기화 필드 추가 (upday1)
        lastModified: p.최종수정일 || p.upday1 || undefined,
        stockQuantity: stockVal !== null && stockVal !== undefined ? parseFloat(String(stockVal)) : undefined,
        bomStatus: p['BOM여부'] || undefined,
        ispack: p.ispack, // Map ispack directly for logic checks
        comcode: sanitizeString(p.거래처코드 || p.comcode),
        gubun1: sanitizeString(p.gubun1 || p.대분류코드 || p.대분류),
        gubun2: sanitizeString(p.gubun2 || p.중분류코드 || p.중분류),
        gubun3: sanitizeString(p.gubun3 || p.소분류코드 || p.소분류),
    };
};

export const mapSqlResultToCustomer = (c: any): Customer => ({
    comcode: sanitizeString(c.거래처코드 || c.comcode || ''),
    name: sanitizeString(c.거래처명 || c.comname || c.name || ''),
});
