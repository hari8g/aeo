#!/usr/bin/env node
import { startSlackRuntime } from './slackRuntime.js'

const PLATFORM_URL = process.env.AVP_PLATFORM_URL ?? 'http://localhost:7070'
void startSlackRuntime(PLATFORM_URL)
