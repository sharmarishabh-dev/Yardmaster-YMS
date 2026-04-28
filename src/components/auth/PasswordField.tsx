import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  inputClassName?: string;
};

export function PasswordField({ inputClassName, ...props }: Props) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative mt-2">
      <input
        {...props}
        type={show ? "text" : "password"}
        className={`block w-full border-2 border-ink bg-background px-4 py-3 pr-12 font-mono text-sm outline-none focus:bg-paper focus:ring-2 focus:ring-hazard ${inputClassName ?? ""}`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center justify-center text-muted-foreground transition hover:text-ink"
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
