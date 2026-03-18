import { WifiOff } from "lucide-react";

export default function OfflinePage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <WifiOff className="h-16 w-16 text-muted-foreground/40" />
      <h1 className="text-2xl font-semibold">Sin conexión</h1>
      <p className="text-muted-foreground max-w-sm">
        No hay conexión a internet. Verifica tu red e intenta de nuevo.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Reintentar
      </button>
    </div>
  );
}
