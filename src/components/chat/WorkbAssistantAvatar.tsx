interface Props {
  size?: number
}

export default function WorkbAssistantAvatar({ size = 36 }: Props) {
  return (
    <img
      src="/brand/chatbot.png"
      alt="AI 도우미"
      width={size}
      height={size}
      className="rounded-md object-contain"
    />
  )
}
