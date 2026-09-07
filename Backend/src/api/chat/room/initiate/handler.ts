/**
 * M25: 责任人主动发起会话处理函数
 * POST /api/chat/room/initiate
 */

import { ChatController, IChatOperatorContext } from "../../../../apps/chat/chatController.js";
import { IInitiateRoomRequest, IInitiateRoomResponseDto } from "../../../../apps/chat/chatTypes.js";
import { StandardResult } from "../../../../shared/flow/result.js";

export async function handleInitiateRoom(
  operator: IChatOperatorContext,
  body: IInitiateRoomRequest
): Promise<StandardResult<IInitiateRoomResponseDto>> {
  return ChatController.handleInitiateRoom(operator, body);
}
