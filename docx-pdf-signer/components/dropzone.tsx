"use client";
import * as React from "react";
import { UploadCloud, FileCheck2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DropzoneProps {
  accept: string; // ex: ".docx" ou ".pdf"
  label: string;
  file: File | null;
  onFile: (file: File | null) => void;
}

export function Dropzone({ accept, label, file, onFile }: DropzoneProps) {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const matches = (name: string) =>
    accept.split(",").some((ext) => name.toLowerCase().endsWith(ext.trim()));

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && matches(f.name)) onFile(f);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
        dragging ? "border-primary bg-secondary" : "border-input hover:bg-secondary/50",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <>
          <FileCheck2 className="h-7 w-7 text-primary" />
          <span className="text-sm font-medium">{file.name}</span>
          <span className="text-xs text-muted-foreground">Clique para trocar</span>
        </>
      ) : (
        <>
          <UploadCloud className="h-7 w-7 text-muted-foreground" />
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">Arraste aqui ou clique para selecionar ({accept})</span>
        </>
      )}
    </div>
  );
}
