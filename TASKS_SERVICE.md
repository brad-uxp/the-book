# Tasks Service — Backend Spec

## Prisma Schema

```prisma
enum TaskStatus {
  pending
  in_progress
  blocked
  done
}

model Task {
  id          String     @id @default(uuid())
  title       String
  description String     @default("")  // Rich text content (HTML)
  client_id   String?
  status      TaskStatus @default(pending)
  progress    Int        @default(0)   // 0-100
  due_date    DateTime
  position    Int        @default(0)   // ordering within column
  created_at  DateTime   @default(now())
  updated_at  DateTime   @updatedAt

  client Client? @relation(fields: [client_id], references: [id])

  @@index([status])
  @@index([due_date])
  @@index([client_id])
}

// Add to Client model:
// tasks Task[]
```

## Validation (Zod)

```ts
export const TaskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().default(""),
  client_id: z.string().nullable().optional(),
  status: z.enum(["pending", "in_progress", "blocked", "done"]).default("pending"),
  progress: z.number().int().min(0).max(100).default(0),
  due_date: z.string().min(1, "Due date is required"),
  position: z.number().int().default(0),
});
```

## API Routes

### `GET /api/tasks`
Returns all tasks ordered by position within each status group.
```ts
prisma.task.findMany({
  orderBy: [{ status: "asc" }, { position: "asc" }],
  include: { client: true },
})
```

### `POST /api/tasks`
Create a new task. Auto-assigns position = max(position) + 1 for the target column.

### `PATCH /api/tasks/[id]`
Update task fields. When status changes (drag between columns), also update position.

**Bulk reorder endpoint** (for drag within column):
### `PATCH /api/tasks/reorder`
Body: `{ items: [{ id: string, position: number, status: string }] }`
Updates position and status for multiple tasks in a transaction.

### `DELETE /api/tasks/[id]`
Delete a task. Audit log the deletion.

## Audit Logging
All mutations log to `AuditLog` with `entity_type: "task"`.
