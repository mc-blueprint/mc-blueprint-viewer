import { Ajv2020 } from 'ajv/dist/2020.js'
import sceneSchema from '../../schema/scene.schema.json'
import editsSchema from '../../schema/edits.schema.json'
import type { SceneDocument } from '../scene/types'
import type { EditDocument } from '../ui/edits'

const ajv = new Ajv2020({ strict: false, allErrors: true })

export const validateScene = ajv.compile<SceneDocument>(sceneSchema)
export const validateEdits = ajv.compile<EditDocument>(editsSchema)
