/**
 * M37: 微信小程序类 QQ 聊天气泡与协同视窗类型契约
 * (Patrol Chat Room MiniProgram Types)
 */

export interface IChatMessageItem {
  id: number | string;
  chatRoomId: number;
  senderId: number;
  senderRole: number;
  senderName?: string;
  senderAvatar?: string;
  isSelf?: boolean;
  type: 0 | 1 | 2 | 3;
  content: string;
  answerMessageId?: number;
  isWithDraw: 0 | 1 | boolean;
  canReEdit?: boolean;
  originalText?: string;
  createdAt: string;
  isLoading?: boolean;
  isFailed?: boolean;
  imageMeta?: {
    boxWidth: number;
    boxHeight: number;
  };
  quotedMessage?: {
    id: number;
    senderName: string;
    summary: string;
  };
}

export interface IChatRoomPageData {
  chatRoomId: number;
  patrolId: number;
  orderNo: string;
  statusText: string;
  locationName: string;
  myUserId: number;
  isMaster: boolean;
  initiatedByHandler: boolean;
  isClosed: boolean;
  roomTitle: string;
  inputText: string;
  messageList: IChatMessageItem[];
  cursorId: number;
  hasMore: boolean;
  isSending: boolean;
  showMediaPanel: boolean;
  scrollIntoViewId: string;
  replyingToMessage: IChatMessageItem | null;
  canInput: boolean;
  lockReason: string;
  showHandshakeButton: boolean;
  highlightMessageId: number;
  isViewingHistoricalSlice: boolean;
}
