import { Play } from "lucide-react";

import AuthButton from "./AuthButton";

/** 비로그인 상태의 메인 영역 — 붉은 재생 버튼을 상징으로 두고 로그인 CTA만 보여준다. */
function LoginPrompt() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
      <div className="relative flex items-center justify-center">
        <div className="absolute size-28 rounded-full bg-primary/30 blur-2xl" />
        <div className="relative flex size-20 items-center justify-center rounded-full bg-primary">
          <Play className="size-8 fill-white text-white" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground">
          로그인해서 쇼츠로 공부해요
        </h1>
      </div>

      <div className="w-full max-w-xs">
        <AuthButton />
      </div>
    </div>
  );
}

export default LoginPrompt;
