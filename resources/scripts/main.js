import '../sass/crater.scss'
import 'v-tooltip/dist/v-tooltip.css'
import '@/scripts/plugins/axios.js'
import * as VueRouter from 'vue-router'
import router from '@/scripts/router/index'
import * as pinia from 'pinia'
import * as Vue from 'vue'
import * as Vuelidate from '@vuelidate/core'

window.pinia = pinia
window.Vuelidate = Vuelidate

import Crater from './Crater'
import { syncManager } from '@/scripts/services/offline/syncManager'

window.Vue = Vue
window.router = router
window.VueRouter = VueRouter

syncManager.init()
window.syncManager = syncManager

window.Crater = new Crater()
