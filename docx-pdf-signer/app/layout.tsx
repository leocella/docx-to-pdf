import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocSign — Converter e Assinar PDF",
  description: "Converte DOCX em PDF com fidelidade e assina com certificado A1 (ICP-Brasil).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
