import { Outlet } from "react-router-dom";
import { useThemePreference } from "../../hooks/useThemePreference";

/**
 * 사이드바·탑바 없이 전체 화면을 사용하는 레이아웃.
 * 실시간 회의(live/*) 라우트에 사용.
 * 테마 훅을 직접 호출해 OS 다크 모드 변경에도 반응.
 */
export default function FullscreenLayout() {
    useThemePreference();
    return (
        <div className="h-screen overflow-hidden bg-background">
            <Outlet />
        </div>
    );
}
