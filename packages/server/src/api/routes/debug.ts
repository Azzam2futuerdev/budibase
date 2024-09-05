import Router from "@koa/router"
import * as controller from "../controllers/debug"
import authorized from "../../middleware/authorized"
import { permissions } from "@budibase/backend-core"

const router: Router = new Router()

router.get(
  "/api/debug/diagnostics",
  authorized(permissions.BUILDER),
  controller.systemDebugInfo
)

router.post(
  "/api/debug/bug-report",
  authorized(permissions.BUILDER),
  controller.bugReport
)

export default router
