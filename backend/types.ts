export type Message = {
    id: string;
    authorId: string;
    author: string;
    text: string;
    createdAt: number;
};

export type User = {
    id: string;
    code: string;
    name: string;
    email: string;
    passwordHash: string;
    blockedUserIds: string[];
    createdAt: number;
};

export type Conversation = {
    id: string;
    type: "direct" | "group";
    name: string;
    email?: string;
    memberIds: string[];
    messages: Message[];
    createdAt: number;
};

export type Database = {
    users: User[];
    conversations: Conversation[];
};

export type PublicUser = Pick<User, "id" | "code" | "name" | "email"> & {
    online: boolean;
};
