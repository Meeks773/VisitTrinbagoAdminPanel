import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-3 items-center">
            <AlertCircle className="h-8 w-8 text-primary" />
            <h1 className="text-2xl font-black uppercase tracking-wide">404</h1>
          </div>
          <p className="text-sm text-muted-foreground font-medium">
            Page not found. The page you're looking for doesn't exist.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
