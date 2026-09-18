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
        <h1 className="font-heading text-l font-semibold tracking-tight text-foreground">
          논문 리뷰, 강의 예습해야 하지만 정말 하기 싫을 때<br />
          AI가 요약해줘도 도저히 글이 눈에 안 들어올 때<br />
        </h1>
        <h1 className="font-heading text-xl font-bold tracking-tight text-foreground">
          PAPERtoSHORTS로 공부해요
        </h1>
      </div>
      <div className="w-full max-w-xs">
        <AuthButton />
      </div>
    </div>
  );
}

export default LoginPrompt;
