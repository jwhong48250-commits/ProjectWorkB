import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../../data/mockData", () => ({
  MEETINGS: [
    {
      id: "2",
      title: "실시간 회의",
      status: "inprogress",
      startAt: "2026-05-07T10:00:00.000Z",
      participants: [],
      actionItemCount: 0,
      decisionCount: 0,
      tags: [],
    },
  ],
}));

vi.mock("../../../api/meetings", () => ({
  endWorkspaceMeeting: vi.fn(),
  fetchWorkspaceMeetingDetail: vi.fn().mockResolvedValue({
    id: "2",
    title: "실시간 회의",
    status: "inprogress",
    startAt: "2026-05-07T10:00:00.000Z",
    participants: [],
    actionItemCount: 0,
    decisionCount: 0,
    tags: [],
  }),
}));

vi.mock("../../../utils/workspace", () => ({
  getCurrentWorkspaceId: () => 11,
}));

vi.mock("../../../utils/deviceSettings", () => ({
  getMicEnabled: () => true,
  getSelectedCameraId: () => "",
  getSelectedMicId: () => "",
}));

vi.mock("../../../utils/meetingRoutes", () => ({
  persistMeetingSnapshot: vi.fn(),
  readMeetingSnapshotForRoute: vi.fn().mockReturnValue(null),
}));

vi.mock("../../../hooks/useLiveSTT", () => ({
  useLiveSTT: () => ({
    wsStatus: "connected",
    liveText: "",
    diarization: [],
    errorMsg: "",
    micOn: true,
    toggleMic: vi.fn(),
    stopMeeting: vi.fn(),
  }),
}));

vi.mock("../../../pages/live/LiveScreenPage", () => ({
  default: () => <div>LiveScreenPage</div>,
}));

vi.mock("../../../pages/live/LiveImagePanel", () => ({
  default: () => <div>LiveImagePanel</div>,
}));

import LivePage from "../../../pages/live/LivePage";

describe("LivePage leave guard", () => {
  const addWindowListenerSpy = vi.spyOn(window, "addEventListener");
  const removeWindowListenerSpy = vi.spyOn(window, "removeEventListener");
  const addDocumentListenerSpy = vi.spyOn(document, "addEventListener");
  const removeDocumentListenerSpy = vi.spyOn(document, "removeEventListener");
  const pushStateSpy = vi.spyOn(window.history, "pushState");

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/live/2");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  function renderLivePage() {
    return render(
      <MemoryRouter initialEntries={["/live/2"]}>
        <Routes>
          <Route path="/live/:meetingId" element={<LivePage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("마운트 시 페이지 이탈 방지 리스너를 등록하고 언마운트 시 해제합니다", async () => {
    const { unmount } = renderLivePage();

    await waitFor(() => {
      expect(addWindowListenerSpy).toHaveBeenCalledWith(
        "beforeunload",
        expect.any(Function),
      );
      expect(addWindowListenerSpy).toHaveBeenCalledWith(
        "popstate",
        expect.any(Function),
      );
      expect(addDocumentListenerSpy).toHaveBeenCalledWith(
        "click",
        expect.any(Function),
        true,
      );
      expect(pushStateSpy).toHaveBeenCalled();
    });

    unmount();

    expect(removeWindowListenerSpy).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
    expect(removeWindowListenerSpy).toHaveBeenCalledWith(
      "popstate",
      expect.any(Function),
    );
    expect(removeDocumentListenerSpy).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
      true,
    );
  });
});
