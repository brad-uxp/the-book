export default function Loading() {
  return (
    <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center lg:h-screen">
      <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-muted border-t-foreground" />
    </div>
  );
}
