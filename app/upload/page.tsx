import { Uploader } from "@/components/Uploader";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Add documents" };

export default function UploadPage() {
  return (
    <div className="rise max-w-3xl">
      <PageHeader
        title="Add documents"
        description="Licenses, proformas, contracts, permits, tax notices, bank slips or a pasted chat. Each file is read, filed under the right contact and matter when I'm certain, and checked against what you already have."
      />
      <Uploader />
    </div>
  );
}
