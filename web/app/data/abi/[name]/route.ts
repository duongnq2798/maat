import { notFound } from "next/navigation";
import { ABI_NAMES, abiFile } from "@/lib/docs/abi";

// One static JSON file per published ABI (out/data/abi/MandateVault.json), so a developer can call or decode a vault
// without cloning and building the repo. Linked from the reference pages and listed in llms.txt.
export const dynamic = "force-static";
export const dynamicParams = false;

export async function GET(_req: Request, { params }: RouteContext<"/data/abi/[name]">) {
  const { name } = await params;
  const contract = ABI_NAMES.find((n) => `${n}.json` === name);
  if (!contract) notFound();
  return new Response(`${JSON.stringify(abiFile(contract), null, 2)}\n`, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function generateStaticParams() {
  return ABI_NAMES.map((name) => ({ name: `${name}.json` }));
}
