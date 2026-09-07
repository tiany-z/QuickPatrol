export interface IChatRoomMetaDto {
  chatRoomId: number;
  schoolId: number;
  patrolId: number;
  roomType: "patrol" | "direct" | "group";
  title: string;
  creatorId: number;
  creatorName: string;
  creatorAvatar: string;
  handlerId: number;
  handlerName: string;
  handlerAvatar: string;
  handlerTag: string;
  initiatedByHandler: boolean;
  isClosed: boolean;
  isPinned: boolean;
  permissions: {
    canInput: boolean;
    lockReason: string;
    showHandshakeButton: boolean;
  };
  patrolSummary?: {
    orderNo: string;
    title: string;
    status: number;
    statusName: string;
    locationName: string;
  };
}
