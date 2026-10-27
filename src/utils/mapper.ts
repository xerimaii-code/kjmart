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

/**
 * 발주/입고/검색창 등에서 '상품명 + 규격' 형태를 일관되게 표현하기 위한 헬퍼 함수.
 * 내부 Product 테이블은 단일 스키마(name, spec)로 유지하되,
 * 이미 name에 spec이 포함되어 있는 경우(예: '상품조회_발주' 쿼리 결과) 중복 표기를 방지하고,
 * 분리되어 있는 경우 '상품명 [규격]' 형태로 결합합니다.
 */
export const formatProductDisplayName = (name?: string, spec?: string): string => {
    const cleanName = sanitizeString(name);
    const cleanSpec = sanitizeString(spec);
    if (!cleanSpec) return cleanName;
    if (cleanName.includes(cleanSpec)) return cleanName;
    return `${cleanName} [${cleanSpec}]`;
};

export const mapSqlResultToProduct = (p: any): Product => {
    const stockVal = p.재고수량 !== undefined && p.재고수량 !== null ? p.재고수량 : p.curjago;
    const rawName = sanitizeString(p.상품명 || p.품명 || p.descr || p.name || '');
    const rawSpec = sanitizeString(p.규격 || p.spec || '');
    const rawIsUse = p.사용유무 !== undefined ? String(p.사용유무).trim() : (p.isuse !== undefined ? String(p.isuse).trim() : '1');
    
    return {
        barcode: sanitizeString(p.바코드 || p.barcode || ''),
        name: rawName,
        spec: rawSpec || undefined,
        costPrice: Number(p.매입가 ?? p.money0vat ?? p.costPrice ?? 0),
        sellingPrice: Number(p.판매가 ?? p.money1 ?? p.sellingPrice ?? 0),
        eventCostPrice: p.행사매입가 ? Number(p.행사매입가) : (p.salemoney0 ? Number(p.salemoney0) : undefined),
        salePrice: p.행사판매가 ? Number(p.행사판매가) : (p.salemoney1 ? Number(p.salemoney1) : undefined),
        saleName: sanitizeString(p.행사명 || p.salename) || undefined,
        saleStartDate: formatDateFromSQL(p.행사시작일 || p.startday || p.salestartday),
        saleEndDate: formatDateFromSQL(p.행사종료일 || p.endday || p.saleendday),
        supplierName: sanitizeString(p.거래처명 || p.comname) || undefined,
        lastModified: formatDateFromSQL(p.최종수정일 || p.upday1) || p.최종수정일 || p.upday1 || undefined,
        stockQuantity: stockVal !== null && stockVal !== undefined ? parseFloat(String(stockVal)) : undefined,
        bomStatus: p['BOM여부'] || (p.ispack === '1' || p.ispack === 1 || p.ispack === true ? '묶음' : undefined),
        ispack: p.ispack,
        comcode: sanitizeString(p.거래처코드 || p.comcode),
        gubun1: sanitizeString(p.gubun1 || p.대분류코드 || p.대분류),
        gubun2: sanitizeString(p.gubun2 || p.중분류코드 || p.중분류),
        gubun3: sanitizeString(p.gubun3 || p.소분류코드 || p.소분류),
        isuse: rawIsUse,
    };
};

export const mapSqlResultToCustomer = (c: any): Customer => ({
    comcode: sanitizeString(c.거래처코드 || c.comcode || ''),
    name: sanitizeString(c.거래처명 || c.comname || c.name || ''),
});
