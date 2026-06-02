import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConvertTab } from "@/components/convert-tab";
import { SignTab } from "@/components/sign-tab";
import { CombinedTab } from "@/components/combined-tab";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">DocSign</h1>
        <p className="text-sm text-muted-foreground">
          Converte DOCX em PDF com fidelidade e assina com certificado A1 (ICP-Brasil).
        </p>
      </header>

      <Tabs defaultValue="combined">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="convert">Converter</TabsTrigger>
          <TabsTrigger value="sign">Assinar</TabsTrigger>
          <TabsTrigger value="combined">Converter + Assinar</TabsTrigger>
        </TabsList>

        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <TabsContent value="convert"><ConvertTab /></TabsContent>
          <TabsContent value="sign"><SignTab /></TabsContent>
          <TabsContent value="combined"><CombinedTab /></TabsContent>
        </div>
      </Tabs>
    </main>
  );
}
