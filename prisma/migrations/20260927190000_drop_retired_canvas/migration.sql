-- Drops what the retired global canvas view left behind.
--
-- ACEPTO PERDER ESTOS DATOS — pedido explícito del dueño del producto
-- (2026-09-27): el canvas global se retiró porque conectar tareas y notas
-- entre sí no resultó útil, y sus datos no se migran a ningún lado.
-- Lo que se pierde, y nada más:
--   - "IssueLink": las aristas issue→issue dibujadas en ese canvas;
--   - "CanvasLabel": los chips de texto de ese canvas;
--   - "Task"."canvas_x" / "canvas_y": dónde estaba cada tarjeta.
-- Ninguna tarea, nota, descripción ni dato contable se toca. Las notas canvas
-- nuevas viven en "CanvasNode" / "CanvasEdge", que esta migración no toca.
--
-- Deploy en dos fases: el código que corría cuando esto se aplica ya no
-- nombra estas tablas ni columnas (se quitaron de schema.prisma en el deploy
-- anterior), así que la ventana en la que el contenedor viejo sigue
-- atendiendo mientras el nuevo migra no puede fallar por ellas.
--
-- HAND-WRITTEN from `prisma migrate diff`, which also emitted the usual
--   DROP INDEX "SubscriptionPayment_subscription_id_due_date_active_key";
-- (a partial unique index Prisma cannot model; it stops a subscription period
-- being paid twice). Deliberately absent — prisma/migrations.test.ts guards it.

-- Its foreign keys and its CHECK "IssueLink_no_self_link" go with the table.
DROP TABLE "IssueLink";

DROP TABLE "CanvasLabel";

ALTER TABLE "Task" DROP COLUMN "canvas_x",
                   DROP COLUMN "canvas_y";
