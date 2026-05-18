import { useEffect, useState } from 'react'
import { getCurrentWorkspaceId, WORKSPACE_CHANGED_EVENT } from '../../utils/workspace'
import { useWorkspaceLogo } from '../../utils/workspaceLogo'

interface Props {
  size?: number
}

export default function WorkbAssistantAvatar({ size = 36 }: Props) {
  const [workspaceId, setWorkspaceId] = useState(() => getCurrentWorkspaceId())
  const logoUrl = useWorkspaceLogo(workspaceId)

  useEffect(() => {
    function handleWorkspaceChanged(event: Event) {
      const nextId = (event as CustomEvent<{ id: number }>).detail?.id
      if (Number.isFinite(nextId) && nextId > 0) setWorkspaceId(nextId)
    }

    window.addEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged)
    return () => window.removeEventListener(WORKSPACE_CHANGED_EVENT, handleWorkspaceChanged)
  }, [])

  return (
    <img
      src={logoUrl}
      alt="Workb 로고"
      width={size}
      height={size}
      className="rounded-md object-cover"
    />
  )
}
