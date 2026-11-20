// Company registry lookup (blueprint §7.3). Hackathon: curated data/registry.json.
// Production: Qichacha/Tianyancha behind the same function signature.
import registry from "@/data/registry.json";
import { normalizeCreditCode, normalizeName } from "@/lib/core/normalize";

export type RegistryRecord = {
  credit_code: string;
  legal_name_zh: string;
  legal_name_en: string;
  status: string; // 存续 / 在业 / 注销 / 吊销
  legal_rep: string;
  established: string;
  reg_capital: string;
  business_scope: string;
  address: string;
};

const companies = (registry as { companies: RegistryRecord[] }).companies;

export async function lookupRegistry(q: { creditCode?: string | null; name?: string | null }): Promise<RegistryRecord | null> {
  const code = normalizeCreditCode(q.creditCode);
  if (code) return companies.find((c) => c.credit_code === code) ?? null;
  const n = normalizeName(q.name);
  if (!n) return null;
  return companies.find((c) => normalizeName(c.legal_name_zh) === n || normalizeName(c.legal_name_en) === n) ?? null;
}

export const ACTIVE_STATUSES = ["存续", "在业", "开业"];
