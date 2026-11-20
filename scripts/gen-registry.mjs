// Generates data/registry.json: fictional demo companies with VALID credit codes
// (GB 32100-2015 check digit, and a valid GB 11714 organization-code check inside).
// Run: npm run gen:data
import fs from "node:fs";

const CHARS = "0123456789ABCDEFGHJKLMNPQRTUWXY";
const W18 = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
const ORG_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const W9 = [3, 7, 9, 10, 5, 8, 4, 2];

function orgCode(base8) {
  const sum = [...base8].reduce((s, ch, i) => s + ORG_CHARS.indexOf(ch) * W9[i], 0);
  const c = 11 - (sum % 11);
  return base8 + (c === 10 ? "X" : c === 11 ? "0" : String(c));
}
function creditCode(region6, base8) {
  const org = orgCode(base8);
  if (org.endsWith("X")) throw new Error(`pick another base for ${base8}: X is not a valid USCC char`);
  const first17 = `91${region6}${org}`;
  const sum = [...first17].reduce((s, ch, i) => s + CHARS.indexOf(ch) * W18[i], 0);
  return first17 + CHARS[(31 - (sum % 31)) % 31];
}

const companies = [
  {
    credit_code: creditCode("440300", "MA5G7K2C"),
    legal_name_zh: "深圳市ABC科技有限公司",
    legal_name_en: "Shenzhen ABC Technology Co., Ltd.",
    status: "存续",
    legal_rep: "王建国",
    established: "2016-04-12",
    reg_capital: "500万元人民币",
    business_scope: "电子产品、充电器、电源适配器的研发、生产与销售；货物及技术进出口。",
    address: "深圳市宝安区福永街道桥头社区富桥工业区3栋",
  },
  {
    credit_code: creditCode("440300", "MA5H3Q8N"),
    legal_name_zh: "深圳市鑫达贸易有限公司",
    legal_name_en: "Shenzhen Xinda Trading Co., Ltd.",
    status: "存续",
    legal_rep: "陈丽",
    established: "2021-09-03",
    reg_capital: "10万元人民币",
    business_scope: "国内贸易；电子产品销售；货物及技术进出口。",
    address: "深圳市福田区华强北街道华航社区深南中路3018号",
  },
  {
    credit_code: creditCode("330200", "MA2J9W4D"),
    legal_name_zh: "宁波XYZ电子有限公司",
    legal_name_en: "Ningbo XYZ Electronics Co., Ltd.",
    status: "存续",
    legal_rep: "王凯",
    established: "2013-07-22",
    reg_capital: "1000万元人民币",
    business_scope: "电子元器件、充电器、移动电源的制造、加工；自营和代理各类货物进出口。",
    address: "浙江省宁波市北仑区大碶街道庐山东路88号",
  },
  {
    credit_code: creditCode("441900", "MA4U6E1B"),
    legal_name_zh: "东莞市宏发电器有限公司",
    legal_name_en: "Dongguan Hongfa Electric Appliance Co., Ltd.",
    status: "吊销",
    legal_rep: "李宏",
    established: "2012-02-15",
    reg_capital: "200万元人民币",
    business_scope: "电器配件的生产、销售。",
    address: "东莞市长安镇乌沙社区兴发南路12号",
  },
  {
    credit_code: creditCode("310106", "MA1FL8K3"),
    legal_name_zh: "上海静安置业有限公司",
    legal_name_en: "Shanghai Jing'an Property Co., Ltd.",
    status: "存续",
    legal_rep: "周建华",
    established: "2009-05-18",
    reg_capital: "2000万元人民币",
    business_scope: "房地产经纪；物业管理；自有房屋租赁。",
    address: "上海市静安区虹景路88号",
  },
  {
    credit_code: creditCode("310106", "MA7HX2QT"),
    legal_name_zh: "诺德利斯（上海）贸易有限公司",
    legal_name_en: "Nordlys Trading (Shanghai) Co., Ltd.",
    status: "存续",
    legal_rep: "Alex Morgan",
    established: "2025-03-02",
    reg_capital: "100万元人民币",
    business_scope: "货物进出口；家居用品、电子产品的批发、零售。",
    address: "上海市静安区虹景路88号1203室",
  },
];

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/registry.json", JSON.stringify({ _note: "FICTIONAL companies for the Memini demo. Not real registry data.", companies }, null, 2) + "\n");
for (const c of companies) console.log(c.credit_code, c.legal_name_zh, c.status);
