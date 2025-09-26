// 거래처 정보
export interface Customer {
    comcode: string; // 거래처 코드
    name: string;    // 거래처명
}

// 상품 정보
export interface Product {
    barcode: string; // 바코드
    name: string;    // 품명
    price: number;   // 단가
}

// 발주 항목 (상품 정보 확장)
export interface OrderItem extends Product {
    quantity: number;          // 발주 수량
    unit: '개' | '박스';       // 단위 ('개' 또는 '박스')
    isPromotion?: boolean;   // 행사 상품 여부
}

// 발주 정보
export interface Order {
    id: number;          // 고유 ID (예: 타임스탬프)
    date: string;        // 발주 일자 (ISO 8601 형식)
    customer: Customer;  // 거래처 정보
    items: OrderItem[];  // 발주 항목 목록
    total: number;       // 총 발주 금액
}

// 카메라 설정
export interface CameraSettings {
    deviceId: string | null;
}
