// ── DS_unified 11종 질환 매핑 (단일 소스) ─────────────────────────
// Flask 추론 서버(ai/inference/app.py)의 클래스 순서와 일치해야 함
// Backend(backend/src/routes/records.js)의 CLASS_KEY_MAP과 키 일치해야 함
const VALID_DISEASES = [
  { key: 'psoriasis',               nameKo: '건선',          nameEn: 'Psoriasis' },
  { key: 'atopic_dermatitis',       nameKo: '아토피피부염',   nameEn: 'Atopic Dermatitis' },
  { key: 'acne',                    nameKo: '여드름',         nameEn: 'Acne Vulgaris' },
  { key: 'actinic_keratosis',       nameKo: '광선각화증',     nameEn: 'Actinic Keratosis' },
  { key: 'basal_cell_carcinoma',    nameKo: '기저세포암',     nameEn: 'Basal Cell Carcinoma' },
  { key: 'melanocytic_nevi',        nameKo: '멜라닌세포모반', nameEn: 'Melanocytic Nevi' },
  { key: 'melanoma',                nameKo: '악성흑색종',     nameEn: 'Melanoma' },
  { key: 'seborrheic_keratosis',    nameKo: '지루각화증',     nameEn: 'Seborrheic Keratosis' },
  { key: 'squamous_cell_carcinoma', nameKo: '편평세포암',     nameEn: 'Squamous Cell Carcinoma' },
  { key: 'dermatofibroma',          nameKo: '피부섬유종',     nameEn: 'Dermatofibroma' },
  { key: 'vascular_lesion',         nameKo: '혈관종',         nameEn: 'Vascular Lesion' },
];

// key → {ko, en} 형태 lookup (record_detail.js, my_analyze.js 호환)
const DISEASE_MAP = VALID_DISEASES.reduce((acc, d) => {
  acc[d.key] = { ko: d.nameKo, en: d.nameEn };
  return acc;
}, {});

// 한글명 → key 역매핑 (UI에서 한글 표시 데이터를 키로 변환할 때)
const DISEASE_KO_TO_KEY = VALID_DISEASES.reduce((acc, d) => {
  acc[d.nameKo] = d.key;
  return acc;
}, {});

function diseaseByKoName(nameKo) {
  return VALID_DISEASES.find(d => d.nameKo === nameKo) ?? { key: nameKo, nameKo, nameEn: nameKo };
}

function getDiseaseLabel(key) {
  return DISEASE_MAP[key]?.ko || key;
}
