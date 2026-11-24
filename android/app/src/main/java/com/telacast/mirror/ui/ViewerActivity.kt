package com.telacast.mirror.ui

import android.annotation.SuppressLint
import android.app.UiModeManager
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.MediaPlayer
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.telacast.mirror.BuildConfig
import com.telacast.mirror.data.AppUpdateManager
import com.telacast.mirror.data.OfflineLicenseManager
import com.telacast.mirror.databinding.ActivityViewerBinding
import com.telacast.mirror.service.FloatingBroadcastService
import com.telacast.mirror.service.ScreenMirrorService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.coroutineContext

class ViewerActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_IS_ADMIN = "extra_is_admin"
        const val EXTRA_START_TAB = "extra_start_tab"
        private const val PREFS_VIEWER = "telacast_viewer_prefs"
        private const val KEY_SCREEN_MODE = "screen_mode"
        private const val KEY_VIEWER_CPF = "viewer_cpf"
        private const val AUTO_HIDE_DELAY_MS = 3800L
    }

    private enum class TabMode {
        LIVE,
        CINEMA
    }

    private enum class SourceMode {
        ONLINE_LIVE,
        LAN_WIFI
    }

    private enum class ScreenMode(val label: String) {
        SMALL("Pequena"),
        MEDIUM("Média"),
        FIT("Ajustar"),
        FILL("Preencher"),
        FULLSCREEN("Tela Cheia")
    }

    private data class CinemaSession(
        val id: String,
        val title: String,
        val videoUrl: String,
        val genre: String,
        val synopsis: String,
        val ticketPrice: String,
        val isFree: Boolean,
        val startTimeMs: Long,
        val durationMinutes: Int,
        val active: Boolean
    ) {
        val endTimeMs: Long
            get() = startTimeMs + durationMinutes.coerceAtLeast(1) * 60_000L
    }

    private data class UnlockedCinemaTicket(
        val videoUrl: String,
        val expiresAtMs: Long,
        val status: String
    )

    private lateinit var binding: ActivityViewerBinding
    private var streamJob: Job? = null
    private var cinemaPollJob: Job? = null
    private var liveWebSocket: WebSocket? = null
    private var audioTrack: AudioTrack? = null
    private var audioSampleRate: Int = 24000
    private val decodingVideoFrame = AtomicBoolean(false)

    private var cinemaMediaPlayer: MediaPlayer? = null
    private var cinemaSessions: List<CinemaSession> = emptyList()
    private val unlockedCinemaMap = mutableMapOf<String, UnlockedCinemaTicket>()
    private var savedViewerCpf: String = ""
    private var currentPlayingCinemaId: String? = null
    private var serverClockOffsetMs: Long = 0L

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build()

    private var authMode: String = "offline"
    private var authToken: String = ""
    private var userName: String = ""
    private var planName: String = ""
    private var isAdminMode: Boolean = false

    private var tabMode: TabMode = TabMode.LIVE
    private var sourceMode: SourceMode = SourceMode.ONLINE_LIVE
    private var screenMode: ScreenMode = ScreenMode.FIT
    private var controlsVisible: Boolean = true
    private var isMuted: Boolean = false
    private var hasReceivedLiveFrame: Boolean = false

    private val overlayHandler = Handler(Looper.getMainLooper())
    private val hideControlsRunnable = Runnable {
        if (isMediaActivelyPlaying() && controlsVisible) {
            setControlsVisible(false)
        }
    }

    private fun isRunningOnTv(): Boolean {
        val uiModeManager = getSystemService(Context.UI_MODE_SERVICE) as UiModeManager
        return uiModeManager.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Proteção anti-retransmissão: impede captura de tela, gravação ou espelhamento da tela do player
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )

        authMode = intent.getStringExtra(MainActivity.EXTRA_AUTH_MODE) ?: "offline"
        authToken = intent.getStringExtra(MainActivity.EXTRA_AUTH_TOKEN) ?: ""
        userName = intent.getStringExtra(MainActivity.EXTRA_USER_NAME) ?: "Assinante"
        planName = intent.getStringExtra(MainActivity.EXTRA_PLAN_NAME) ?: ""
        isAdminMode = intent.getBooleanExtra(EXTRA_IS_ADMIN, false)
        val startTab = intent.getStringExtra(EXTRA_START_TAB).orEmpty()
        if (startTab == "cinema" || authMode == "cinema_cpf") {
            tabMode = TabMode.CINEMA
        }

        // Garante que nenhum cliente comum veja botão flutuante de transmissão admin
        if (!isAdminMode) {
            ocultarOverlayFlutuanteAdmin()
        }

        binding = ActivityViewerBinding.inflate(layoutInflater)
        setContentView(binding.root)

        screenMode = carregarScreenModeSalvo()
        savedViewerCpf = getSharedPreferences(PREFS_VIEWER, Context.MODE_PRIVATE)
            .getString(KEY_VIEWER_CPF, "")
            .orEmpty()
            .replace(Regex("\\D"), "")
        if (savedViewerCpf.length == 11) {
            binding.inputViewerCpf.setText(savedViewerCpf)
        }

        if (authMode == "cinema_cpf") {
            binding.btnTabLive.visibility = View.GONE
        }

        configurarWebViewCinema()
        configurarBotoes()
        atualizarBotaoConta()
        atualizarBotoesTamanho()
        atualizarAbasUi()
        aplicarModoTela()

        // Tenta conectar automaticamente no modo Ao Vivo Online quando na aba Ao Vivo
        if (tabMode == TabMode.LIVE && authMode != "cinema_cpf" && (!isAdminMode || sourceMode == SourceMode.ONLINE_LIVE)) {
            conectarAoVivoOnline()
        }

        carregarDadosPixCinema()
        carregarProgramacaoCinema(forcarPlayAtivo = tabMode == TabMode.CINEMA)
        iniciarTickerCinema()
        AppUpdateManager.syncAndCheckForUpdates(this)
    }

    private fun ocultarOverlayFlutuanteAdmin() {
        runCatching {
            val hideIntent = Intent(this, FloatingBroadcastService::class.java).apply {
                action = FloatingBroadcastService.ACTION_HIDE
            }
            startService(hideIntent)
            stopService(Intent(this, FloatingBroadcastService::class.java))
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configurarWebViewCinema() {
        binding.webCinema.apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            webChromeClient = WebChromeClient()
            webViewClient = WebViewClient()
        }
    }

    private fun configurarBotoes() {
        binding.playerStage.setOnClickListener {
            toggleControlsVisibility()
        }

        binding.imgStream.setOnClickListener {
            toggleControlsVisibility()
        }

        binding.btnTabLive.setOnClickListener {
            if (tabMode != TabMode.LIVE) {
                tabMode = TabMode.LIVE
                pararCinemaPlayer()
                atualizarAbasUi()
                aplicarModoTela()
                if (!isConnectedOrConnecting() && sourceMode == SourceMode.ONLINE_LIVE) {
                    conectarAoVivoOnline()
                }
            }
            reiniciarTimerAutoOcultar()
        }

        binding.btnTabCinema.setOnClickListener {
            if (tabMode != TabMode.CINEMA) {
                tabMode = TabMode.CINEMA
                desconectar()
                atualizarAbasUi()
                aplicarModoTela()
                carregarProgramacaoCinema(forcarPlayAtivo = true)
            } else {
                carregarProgramacaoCinema(forcarPlayAtivo = true)
            }
            reiniciarTimerAutoOcultar()
        }

        binding.btnRefreshCinema.setOnClickListener {
            carregarDadosPixCinema()
            carregarProgramacaoCinema(forcarPlayAtivo = true)
        }

        binding.btnVerifyCpf.setOnClickListener {
            verificarCpfCinema(forcarPlay = true)
        }

        binding.btnRequestPixTicket.setOnClickListener {
            val targetSession = cinemaSessions.firstOrNull { !it.isFree && agoraSincronizado() < it.endTimeMs }
                ?: cinemaSessions.firstOrNull { agoraSincronizado() < it.endTimeMs }
            if (targetSession == null) {
                Toast.makeText(this, "Nenhum filme pago disponível no momento.", Toast.LENGTH_SHORT).show()
            } else {
                solicitarIngressoPixCinema(targetSession)
            }
        }

        binding.btnConectar.setOnClickListener {
            if (tabMode == TabMode.CINEMA) {
                if (currentPlayingCinemaId != null) {
                    pararCinemaPlayer()
                    binding.txtViewerStatus.text = "Reprodução pausada. Escolha um filme na programação."
                    binding.txtViewerStatus.visibility = View.VISIBLE
                    atualizarBotaoConectar()
                } else {
                    carregarProgramacaoCinema(forcarPlayAtivo = true)
                }
                reiniciarTimerAutoOcultar()
                return@setOnClickListener
            }

            if (isConnectedOrConnecting()) {
                desconectar()
            } else if (sourceMode == SourceMode.ONLINE_LIVE) {
                conectarAoVivoOnline()
            } else {
                conectarLanComInputs()
            }
            reiniciarTimerAutoOcultar()
        }

        binding.btnAudioMute.setOnClickListener {
            isMuted = !isMuted
            atualizarBotaoSom()
            aplicarVolumeCinema()
            reiniciarTimerAutoOcultar()
        }

        binding.btnSizeSmall.setOnClickListener { definirScreenMode(ScreenMode.SMALL) }
        binding.btnSizeMedium.setOnClickListener { definirScreenMode(ScreenMode.MEDIUM) }
        binding.btnSizeFit.setOnClickListener { definirScreenMode(ScreenMode.FIT) }
        binding.btnSizeFill.setOnClickListener { definirScreenMode(ScreenMode.FILL) }
        binding.btnSizeFullscreen.setOnClickListener {
            val next = if (screenMode == ScreenMode.FULLSCREEN) ScreenMode.FIT else ScreenMode.FULLSCREEN
            definirScreenMode(next)
        }

        // Botão Wi-Fi TV só visível em Smart TV ou no modo Admin
        val podeUsarWifiTv = isRunningOnTv() || isAdminMode
        binding.btnTvWifiToggle.visibility = if (podeUsarWifiTv) View.VISIBLE else View.GONE
        binding.btnTvWifiToggle.setOnClickListener {
            if (sourceMode == SourceMode.ONLINE_LIVE) {
                desconectar()
                sourceMode = SourceMode.LAN_WIFI
                binding.layoutTvWifiDrawer.visibility = View.VISIBLE
                binding.txtViewerStatus.text = "Informe o IP e o token para assistir pela rede Wi-Fi (Smart TV)"
                binding.txtViewerStatus.visibility = View.VISIBLE
            } else {
                sourceMode = SourceMode.ONLINE_LIVE
                binding.layoutTvWifiDrawer.visibility = View.GONE
                desconectar()
                conectarAoVivoOnline()
            }
            atualizarBotaoConectar()
            reiniciarTimerAutoOcultar()
        }

        binding.btnConnectWifi.setOnClickListener {
            sourceMode = SourceMode.LAN_WIFI
            desconectar()
            conectarLanComInputs()
            reiniciarTimerAutoOcultar()
        }

        binding.btnSairViewer.setOnClickListener {
            if (isAdminMode) {
                finish()
            } else if (authMode == "cinema_cpf") {
                desconectar()
                pararCinemaPlayer()
                startActivity(Intent(this, LoginActivity::class.java))
                finish()
            } else {
                mostrarDialogoContaCliente()
            }
        }
    }

    private fun atualizarBotaoConta() {
        binding.btnSairViewer.text = when {
            isAdminMode -> "Painel Admin"
            authMode == "cinema_cpf" -> "Voltar"
            else -> "Conta"
        }
        atualizarBotaoSom()
        atualizarBotaoConectar()
    }

    private fun mostrarDialogoContaCliente() {
        val deviceCode = OfflineLicenseManager.getOrCreateDeviceCode(this)
        val detalhe = buildString {
            append("Perfil: $userName\n")
            if (planName.isNotBlank()) append("Plano: $planName\n")
            append("Código do aparelho: $deviceCode")
        }
        AlertDialog.Builder(this)
            .setTitle("Minha Conta")
            .setMessage(detalhe)
            .setPositiveButton("Continuar Assistindo", null)
            .setNegativeButton("Trocar Conta / Sair") { _, _ ->
                desconectar()
                pararCinemaPlayer()
                OfflineLicenseManager.clearLicense(this)
                startActivity(Intent(this, LoginActivity::class.java))
                finish()
            }
            .show()
    }

    private fun carregarScreenModeSalvo(): ScreenMode {
        val raw = getSharedPreferences(PREFS_VIEWER, Context.MODE_PRIVATE)
            .getString(KEY_SCREEN_MODE, ScreenMode.FIT.name)
        return runCatching { ScreenMode.valueOf(raw ?: ScreenMode.FIT.name) }.getOrDefault(ScreenMode.FIT)
    }

    private fun definirScreenMode(mode: ScreenMode) {
        screenMode = mode
        getSharedPreferences(PREFS_VIEWER, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SCREEN_MODE, mode.name)
            .apply()
        atualizarBotoesTamanho()
        aplicarModoTela()
        reiniciarTimerAutoOcultar()
    }

    private fun aplicarModoTela() {
        val isCinema = tabMode == TabMode.CINEMA
        val lp = binding.playerStage.layoutParams as LinearLayout.LayoutParams

        when (screenMode) {
            ScreenMode.SMALL -> {
                lp.width = LinearLayout.LayoutParams.MATCH_PARENT
                lp.height = dp(220)
                lp.weight = 0f
                binding.imgStream.scaleType = ImageView.ScaleType.FIT_CENTER
                binding.scrollCinemaShelf.visibility = if (isCinema) View.VISIBLE else View.GONE
                sairModoImersivo()
            }

            ScreenMode.MEDIUM -> {
                lp.width = LinearLayout.LayoutParams.MATCH_PARENT
                lp.height = dp(330)
                lp.weight = 0f
                binding.imgStream.scaleType = ImageView.ScaleType.FIT_CENTER
                binding.scrollCinemaShelf.visibility = if (isCinema) View.VISIBLE else View.GONE
                sairModoImersivo()
            }

            ScreenMode.FIT -> {
                if (isCinema) {
                    lp.width = LinearLayout.LayoutParams.MATCH_PARENT
                    lp.height = dp(250)
                    lp.weight = 0f
                    binding.scrollCinemaShelf.visibility = View.VISIBLE
                } else {
                    lp.width = LinearLayout.LayoutParams.MATCH_PARENT
                    lp.height = 0
                    lp.weight = 1f
                    binding.scrollCinemaShelf.visibility = View.GONE
                }
                binding.imgStream.scaleType = ImageView.ScaleType.FIT_CENTER
                sairModoImersivo()
            }

            ScreenMode.FILL -> {
                if (isCinema) {
                    lp.width = LinearLayout.LayoutParams.MATCH_PARENT
                    lp.height = dp(280)
                    lp.weight = 0f
                    binding.scrollCinemaShelf.visibility = View.VISIBLE
                } else {
                    lp.width = LinearLayout.LayoutParams.MATCH_PARENT
                    lp.height = 0
                    lp.weight = 1f
                    binding.scrollCinemaShelf.visibility = View.GONE
                }
                binding.imgStream.scaleType = ImageView.ScaleType.CENTER_CROP
                sairModoImersivo()
            }

            ScreenMode.FULLSCREEN -> {
                lp.width = LinearLayout.LayoutParams.MATCH_PARENT
                lp.height = LinearLayout.LayoutParams.MATCH_PARENT
                lp.weight = 1f
                binding.imgStream.scaleType = ImageView.ScaleType.FIT_CENTER
                binding.scrollCinemaShelf.visibility = View.GONE
                binding.layoutTvWifiDrawer.visibility = View.GONE
                entrarModoImersivo()
            }
        }

        binding.playerStage.layoutParams = lp
        binding.txtSyncBadge.text = if (isCinema && currentPlayingCinemaId != null) {
            "Cinema Sincronizado · ${screenMode.label}"
        } else {
            "Tela: ${screenMode.label}"
        }
    }

    private fun entrarModoImersivo() {
        if (!isRunningOnTv()) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        }
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, binding.root)
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }

    private fun sairModoImersivo() {
        if (!isRunningOnTv()) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
        WindowCompat.setDecorFitsSystemWindows(window, true)
        val controller = WindowInsetsControllerCompat(window, binding.root)
        controller.show(WindowInsetsCompat.Type.systemBars())
    }

    private fun atualizarAbasUi() {
        val liveActive = tabMode == TabMode.LIVE
        estilizarBotaoSelecao(binding.btnTabLive, liveActive)
        estilizarBotaoSelecao(binding.btnTabCinema, !liveActive)
        binding.imgStream.visibility = if (liveActive) View.VISIBLE else View.GONE
        binding.txtStageTitle.text = if (liveActive) "Ao Vivo · Jogos do Mengão" else "Cinema Programado"
        atualizarBotaoConectar()
    }

    private fun atualizarBotoesTamanho() {
        estilizarBotaoSelecao(binding.btnSizeSmall, screenMode == ScreenMode.SMALL)
        estilizarBotaoSelecao(binding.btnSizeMedium, screenMode == ScreenMode.MEDIUM)
        estilizarBotaoSelecao(binding.btnSizeFit, screenMode == ScreenMode.FIT)
        estilizarBotaoSelecao(binding.btnSizeFill, screenMode == ScreenMode.FILL)
        estilizarBotaoSelecao(binding.btnSizeFullscreen, screenMode == ScreenMode.FULLSCREEN)
    }

    private fun estilizarBotaoSelecao(btn: MaterialButton, ativo: Boolean) {
        if (ativo) {
            btn.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#C8102E"))
            btn.strokeColor = ColorStateList.valueOf(Color.parseColor("#EF4444"))
            btn.setTextColor(Color.WHITE)
        } else {
            btn.backgroundTintList = ColorStateList.valueOf(Color.parseColor("#18181F"))
            btn.strokeColor = ColorStateList.valueOf(Color.parseColor("#3F3F46"))
            btn.setTextColor(Color.parseColor("#E4E4E7"))
        }
    }

    private fun atualizarBotaoSom() {
        binding.btnAudioMute.text = if (isMuted) "Som: Mudo" else "Som: Ligado"
        estilizarBotaoSelecao(binding.btnAudioMute, !isMuted)
    }

    private fun atualizarBotaoConectar() {
        binding.btnConectar.text = if (tabMode == TabMode.CINEMA) {
            if (currentPlayingCinemaId != null) "Pausar Filme" else "Assistir Agora"
        } else {
            if (isConnectedOrConnecting()) "Desconectar" else "Conectar"
        }
    }

    private fun toggleControlsVisibility() {
        setControlsVisible(!controlsVisible)
    }

    private fun setControlsVisible(visible: Boolean) {
        controlsVisible = visible
        val vis = if (visible) View.VISIBLE else View.GONE
        binding.layoutTopOverlay.visibility = vis
        binding.layoutBottomOverlay.visibility = vis
        if (visible) {
            reiniciarTimerAutoOcultar()
        } else {
            overlayHandler.removeCallbacks(hideControlsRunnable)
        }
    }

    private fun reiniciarTimerAutoOcultar() {
        overlayHandler.removeCallbacks(hideControlsRunnable)
        if (isMediaActivelyPlaying()) {
            overlayHandler.postDelayed(hideControlsRunnable, AUTO_HIDE_DELAY_MS)
        }
    }

    private fun isMediaActivelyPlaying(): Boolean {
        return if (tabMode == TabMode.LIVE) {
            hasReceivedLiveFrame
        } else {
            currentPlayingCinemaId != null
        }
    }

    private fun conectarLanComInputs() {
        if (!isRunningOnTv() && !isAdminMode) {
            Toast.makeText(
                this,
                "Proteção ativa: retransmissão Wi-Fi permitida somente em Smart TVs.",
                Toast.LENGTH_LONG
            ).show()
            return
        }
        val baseUrl = binding.inputEndereco.text?.toString().orEmpty().trim().trimEnd('/')
        val token = binding.inputToken.text?.toString().orEmpty().trim()
        if (baseUrl.isBlank() || token.isBlank()) {
            Toast.makeText(this, "Informe o endereço IP e o token da sessão.", Toast.LENGTH_SHORT).show()
            return
        }
        conectarStreamLan("$baseUrl/stream?token=$token")
    }

    override fun onResume() {
        super.onResume()
        if (!isAdminMode) {
            ocultarOverlayFlutuanteAdmin()
        }
        if (authMode == "offline" && !OfflineLicenseManager.getSavedLicenseState(this).ativo) {
            desconectar()
            pararCinemaPlayer()
            Toast.makeText(this, "Assinatura vencida. Renove para assistir.", Toast.LENGTH_LONG).show()
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
            return
        }
        if (screenMode == ScreenMode.FULLSCREEN) {
            entrarModoImersivo()
        }
    }

    private fun isConnectedOrConnecting(): Boolean {
        return streamJob?.isActive == true || liveWebSocket != null
    }

    private fun conectarAoVivoOnline() {
        val wsUrl = OfflineLicenseManager.getLiveWebSocketUrl()
        if (wsUrl.isNullOrBlank()) {
            binding.txtViewerStatus.text = "URL do servidor não configurada neste APK."
            binding.txtViewerStatus.visibility = View.VISIBLE
            return
        }

        val deviceCode = OfflineLicenseManager.getOrCreateDeviceCode(this)
        val activationKey = OfflineLicenseManager.getSavedActivationKey(this).orEmpty()
        if (activationKey.isBlank() && authToken.isBlank()) {
            binding.txtViewerStatus.text = "Ative uma chave offline ou faça login online para assistir."
            binding.txtViewerStatus.visibility = View.VISIBLE
            return
        }

        hasReceivedLiveFrame = false
        binding.txtViewerStatus.text = "Conectando à transmissão ao vivo..."
        binding.txtViewerStatus.visibility = View.VISIBLE
        atualizarBotaoConectar()

        val request = Request.Builder().url(wsUrl).build()
        liveWebSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val authPayload = JSONObject().apply {
                    put("type", "auth:viewer")
                    put("deviceCode", deviceCode)
                    put("activationKey", activationKey)
                    if (authToken.isNotBlank()) {
                        put("authToken", authToken)
                    }
                }
                webSocket.send(authPayload.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val json = runCatching { JSONObject(text) }.getOrNull() ?: return
                val msgType = json.optString("type", "")
                when (msgType) {
                    "auth:error" -> {
                        val erro = json.optString("erro", "Assinatura necessária para assistir ao vivo.")
                        runOnUiThread {
                            if (isFinishing || isDestroyed) return@runOnUiThread
                            hasReceivedLiveFrame = false
                            binding.txtViewerStatus.text = erro
                            binding.txtViewerStatus.visibility = View.VISIBLE
                            desconectarSocketSilencioso()
                            atualizarBotaoConectar()
                            setControlsVisible(true)
                        }
                    }

                    "auth:ok", "live:state" -> {
                        val state = json.optJSONObject("state") ?: return
                        val isLive = state.optBoolean("isLive", false)
                        val title = state.optString("title", "Transmissão Ao Vivo")
                        val matchMode = state.optString("matchMode", "flamengo")
                        val sourceApp = state.optString("sourceApp", "App selecionado")
                        val sampleRate = state.optInt("sampleRate", 24000).coerceIn(8000, 48000)
                        if (sampleRate != audioSampleRate) {
                            audioSampleRate = sampleRate
                            reiniciarAudioTrack()
                        }
                        runOnUiThread {
                            if (isFinishing || isDestroyed) return@runOnUiThread
                            val prefix = if (matchMode == "outro_jogo") "Outro Jogo · " else ""
                            if (!isLive) {
                                hasReceivedLiveFrame = false
                                binding.txtStageTitle.text = "Ao Vivo · Aguardando"
                                binding.txtViewerStatus.text =
                                    "Conectado · Aguardando o administrador iniciar a transmissão ao vivo..."
                                binding.txtViewerStatus.visibility = View.VISIBLE
                                setControlsVisible(true)
                            } else {
                                binding.txtStageTitle.text = "$prefix$title · $sourceApp"
                                if (!hasReceivedLiveFrame) {
                                    binding.txtViewerStatus.text = "$prefix$title · $sourceApp"
                                    binding.txtViewerStatus.visibility = View.VISIBLE
                                }
                            }
                        }
                    }
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                val raw = bytes.toByteArray()
                if (raw.size < 2) return
                when (raw[0].toInt() and 0xFF) {
                    0x01 -> {
                        if (!decodingVideoFrame.compareAndSet(false, true)) return
                        val bitmap = runCatching {
                            BitmapFactory.decodeByteArray(raw, 1, raw.size - 1)
                        }.getOrNull()
                        if (bitmap != null) {
                            runOnUiThread {
                                if (!isFinishing && !isDestroyed && tabMode == TabMode.LIVE) {
                                    val firstFrame = !hasReceivedLiveFrame
                                    hasReceivedLiveFrame = true
                                    binding.imgStream.setImageBitmap(bitmap)
                                    binding.txtViewerStatus.visibility = View.GONE
                                    if (firstFrame) {
                                        reiniciarTimerAutoOcultar()
                                    }
                                }
                                decodingVideoFrame.set(false)
                            }
                        } else {
                            decodingVideoFrame.set(false)
                        }
                    }

                    0x02 -> {
                        if (!isMuted && tabMode == TabMode.LIVE) {
                            reproduzirPcmAudio(raw, 1, raw.size - 1)
                        }
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                runOnUiThread {
                    if (liveWebSocket === webSocket) {
                        liveWebSocket = null
                        hasReceivedLiveFrame = false
                        liberarAudioTrack()
                        binding.txtViewerStatus.text =
                            "Falha na conexão ao vivo: ${t.localizedMessage ?: "verifique sua internet"}"
                        binding.txtViewerStatus.visibility = View.VISIBLE
                        atualizarBotaoConectar()
                        setControlsVisible(true)
                    }
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                runOnUiThread {
                    if (liveWebSocket === webSocket) {
                        liveWebSocket = null
                        hasReceivedLiveFrame = false
                        liberarAudioTrack()
                        atualizarBotaoConectar()
                        if (tabMode == TabMode.LIVE && binding.txtViewerStatus.visibility != View.VISIBLE) {
                            binding.txtViewerStatus.text = "Transmissão encerrada."
                            binding.txtViewerStatus.visibility = View.VISIBLE
                        }
                        setControlsVisible(true)
                    }
                }
            }
        })
    }

    private fun garantirAudioTrack(): AudioTrack? {
        val current = audioTrack
        if (current != null && current.state == AudioTrack.STATE_INITIALIZED) {
            return current
        }
        return runCatching {
            val minBuf = AudioTrack.getMinBufferSize(
                audioSampleRate,
                AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            ).coerceAtLeast(4096)

            val track = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(audioSampleRate)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build()
                )
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setBufferSizeInBytes(minBuf * 2)
                .build()
            track.play()
            audioTrack = track
            track
        }.getOrNull()
    }

    private fun reproduzirPcmAudio(buffer: ByteArray, offset: Int, length: Int) {
        if (length <= 1) return
        val track = garantirAudioTrack() ?: return
        runCatching {
            track.write(buffer, offset, length, AudioTrack.WRITE_NON_BLOCKING)
        }
    }

    private fun reiniciarAudioTrack() {
        liberarAudioTrack()
    }

    private fun liberarAudioTrack() {
        val track = audioTrack
        audioTrack = null
        if (track != null) {
            runCatching {
                track.pause()
                track.flush()
                track.release()
            }
        }
    }

    private fun conectarStreamLan(url: String) {
        hasReceivedLiveFrame = false
        binding.txtViewerStatus.text = "Conectando ao transmissor Wi-Fi..."
        binding.txtViewerStatus.visibility = View.VISIBLE
        atualizarBotaoConectar()

        val isTv = isRunningOnTv()
        streamJob = lifecycleScope.launch(Dispatchers.IO) {
            try {
                val req = Request.Builder()
                    .url(url)
                    .addHeader(
                        ScreenMirrorService.APP_CLIENT_HEADER,
                        if (isTv) ScreenMirrorService.TV_CLIENT_SIGNATURE else ScreenMirrorService.APP_CLIENT_SIGNATURE
                    )
                    .addHeader(
                        ScreenMirrorService.DEVICE_TYPE_HEADER,
                        if (isTv) "tv" else "mobile"
                    )
                    .get()
                    .build()

                client.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) {
                        withContext(Dispatchers.Main) {
                            binding.txtViewerStatus.text = "Acesso negado (HTTP ${res.code}). Verifique o token."
                            atualizarBotaoConectar()
                        }
                        return@launch
                    }

                    val inputStream: InputStream = res.body?.byteStream() ?: return@launch
                    withContext(Dispatchers.Main) {
                        hasReceivedLiveFrame = true
                        binding.txtViewerStatus.visibility = View.GONE
                        reiniciarTimerAutoOcultar()
                    }

                    lerQuadrosMjpeg(inputStream) { jpegBytes ->
                        val bitmap = BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size)
                        if (bitmap != null) {
                            withContext(Dispatchers.Main) {
                                binding.imgStream.setImageBitmap(bitmap)
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    hasReceivedLiveFrame = false
                    binding.txtViewerStatus.text = "Conexão encerrada: ${e.localizedMessage ?: "erro"}"
                    binding.txtViewerStatus.visibility = View.VISIBLE
                    atualizarBotaoConectar()
                    setControlsVisible(true)
                }
            }
        }
    }

    private suspend fun lerQuadrosMjpeg(
        stream: InputStream,
        onFrame: suspend (ByteArray) -> Unit
    ) {
        val buffer = ByteArrayOutputStream()
        var prev = -1
        var insideJpeg = false

        while (coroutineContext.isActive) {
            val b = stream.read()
            if (b == -1) break

            if (!insideJpeg) {
                if (prev == 0xFF && b == 0xD8) {
                    insideJpeg = true
                    buffer.reset()
                    buffer.write(0xFF)
                    buffer.write(0xD8)
                }
            } else {
                buffer.write(b)
                if (prev == 0xFF && b == 0xD9) {
                    insideJpeg = false
                    onFrame(buffer.toByteArray())
                }
            }
            prev = b
        }
    }

    private fun iniciarTickerCinema() {
        cinemaPollJob?.cancel()
        cinemaPollJob = lifecycleScope.launch {
            var tickCount = 0
            while (isActive) {
                delay(1000L)
                tickCount++
                if (tabMode == TabMode.CINEMA) {
                    if (tickCount % 25 == 0) {
                        carregarProgramacaoCinema(forcarPlayAtivo = false)
                    } else {
                        atualizarEstadoCinemaSincronizado(forcarPlay = false)
                    }
                }
            }
        }
    }

    private fun carregarDadosPixCinema() {
        val apiBase = BuildConfig.API_BASE_URL.trim().trimEnd('/')
        if (!apiBase.startsWith("http")) return
        lifecycleScope.launch(Dispatchers.IO) {
            val info = runCatching {
                val req = Request.Builder().url("$apiBase/api/config/public").get().build()
                client.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) return@use null
                    JSONObject(res.body?.string().orEmpty())
                }
            }.getOrNull()
            withContext(Dispatchers.Main) {
                if (isFinishing || isDestroyed || info == null) return@withContext
                val pixKey = info.optString("pixKey", "").trim()
                val holder = info.optString("pixReceiverName", "").trim()
                    .ifBlank { info.optString("pixBeneficiaryName", "").trim() }
                binding.txtCinemaPixInfo.text = if (pixKey.isNotBlank()) {
                    "Chave Pix: $pixKey${if (holder.isNotBlank()) " ($holder)" else ""}"
                } else {
                    "Solicite a chave Pix ao administrador e informe seu CPF abaixo."
                }
            }
        }
    }

    private fun carregarProgramacaoCinema(forcarPlayAtivo: Boolean = false) {
        val apiBase = BuildConfig.API_BASE_URL.trim().trimEnd('/')
        if (!apiBase.startsWith("http")) return

        lifecycleScope.launch(Dispatchers.IO) {
            val useAdminEndpoint = isAdminMode && authToken.isNotBlank()
            val url = if (useAdminEndpoint) "$apiBase/api/admin/cinema" else "$apiBase/api/cinema/schedule"
            val result = runCatching {
                val reqBuilder = Request.Builder().url(url).get()
                if (useAdminEndpoint) {
                    reqBuilder.addHeader("Authorization", "Bearer $authToken")
                }
                client.newCall(reqBuilder.build()).execute().use { res ->
                    if (!res.isSuccessful) return@use null
                    val body = res.body?.string().orEmpty()
                    JSONObject(body)
                }
            }.getOrNull()

            withContext(Dispatchers.Main) {
                if (isFinishing || isDestroyed || result == null) return@withContext
                val serverNow = parseTimestampMs(result.opt("serverNow")) ?: System.currentTimeMillis()
                serverClockOffsetMs = serverNow - System.currentTimeMillis()
                val arr = result.optJSONArray("sessions") ?: JSONArray()
                val parsed = mutableListOf<CinemaSession>()
                for (i in 0 until arr.length()) {
                    val obj = arr.optJSONObject(i) ?: continue
                    val id = obj.optString("id", "").trim()
                    val title = obj.optString("title", "").trim()
                    val videoUrl = obj.optString("videoUrl", "").trim()
                    val ticketPrice = obj.optString("ticketPrice", "R$ 10,00").trim().ifBlank { "R$ 10,00" }
                    val isFree = obj.optBoolean("isFree", videoUrl.isNotBlank() && ticketPrice.contains("0,00"))
                    val startMs = parseTimestampMs(obj.opt("startTime")) ?: 0L
                    val duration = obj.optInt("durationMinutes", 90).coerceAtLeast(1)
                    val active = obj.optBoolean("active", true)
                    if (id.isNotBlank() && title.isNotBlank() && startMs > 0L && active) {
                        parsed.add(
                            CinemaSession(
                                id = id,
                                title = title,
                                videoUrl = videoUrl,
                                genre = obj.optString("genre", "Cinema"),
                                synopsis = obj.optString("synopsis", ""),
                                ticketPrice = ticketPrice,
                                isFree = isFree,
                                startTimeMs = startMs,
                                durationMinutes = duration,
                                active = active
                            )
                        )
                    }
                }
                cinemaSessions = parsed.sortedBy { it.startTimeMs }
                if (savedViewerCpf.length == 11) {
                    verificarCpfCinema(forcarPlay = forcarPlayAtivo, silentInputCheck = true)
                } else {
                    renderizarListaCinema()
                    if (tabMode == TabMode.CINEMA) {
                        atualizarEstadoCinemaSincronizado(forcarPlay = forcarPlayAtivo)
                    }
                }
            }
        }
    }

    private fun verificarCpfCinema(forcarPlay: Boolean = false, silentInputCheck: Boolean = false) {
        val rawCpf = binding.inputViewerCpf.text?.toString().orEmpty().replace(Regex("\\D"), "")
        val cpfDigits = if (rawCpf.length == 11) rawCpf else savedViewerCpf
        if (cpfDigits.length != 11) {
            if (!silentInputCheck) {
                Toast.makeText(this, "Informe um CPF válido com 11 números.", Toast.LENGTH_SHORT).show()
            }
            return
        }

        savedViewerCpf = cpfDigits
        getSharedPreferences(PREFS_VIEWER, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_VIEWER_CPF, cpfDigits)
            .apply()

        val apiBase = BuildConfig.API_BASE_URL.trim().trimEnd('/')
        if (!apiBase.startsWith("http")) return

        if (!silentInputCheck) {
            binding.txtCpfStatus.text = "Consultando liberação do CPF..."
        }

        lifecycleScope.launch(Dispatchers.IO) {
            val result = runCatching {
                val payload = JSONObject().put("cpf", cpfDigits).toString()
                val req = Request.Builder()
                    .url("$apiBase/api/cinema/verify-cpf")
                    .post(payload.toRequestBody("application/json; charset=utf-8".toMediaType()))
                    .build()
                client.newCall(req).execute().use { res ->
                    val bodyStr = res.body?.string().orEmpty()
                    val json = runCatching { JSONObject(bodyStr) }.getOrNull()
                    if (!res.isSuccessful) {
                        throw IllegalStateException(json?.optString("erro") ?: "Erro HTTP ${res.code}")
                    }
                    json ?: JSONObject()
                }
            }

            withContext(Dispatchers.Main) {
                if (isFinishing || isDestroyed) return@withContext
                result.onSuccess { json ->
                    val serverNow = parseTimestampMs(json.opt("serverNow")) ?: System.currentTimeMillis()
                    serverClockOffsetMs = serverNow - System.currentTimeMillis()
                    unlockedCinemaMap.clear()

                    val unlockedArr = json.optJSONArray("unlockedSessions") ?: JSONArray()
                    for (i in 0 until unlockedArr.length()) {
                        val s = unlockedArr.optJSONObject(i) ?: continue
                        val sid = s.optString("id", "").trim()
                        val vUrl = s.optString("videoUrl", "").trim()
                        val startMs = parseTimestampMs(s.opt("startTime")) ?: 0L
                        val durMin = s.optInt("durationMinutes", 90).coerceAtLeast(1)
                        val expMs = startMs + durMin * 60_000L
                        if (sid.isNotBlank() && vUrl.isNotBlank()) {
                            unlockedCinemaMap[sid] = UnlockedCinemaTicket(
                                videoUrl = vUrl,
                                expiresAtMs = expMs,
                                status = "liberado"
                            )
                        }
                    }

                    val ticketsArr = json.optJSONArray("tickets") ?: JSONArray()
                    val cpfMasked = json.optString("cpfMasked", cpfDigits)
                    var releasedTitle = ""
                    var releasedExpMs = 0L
                    var hasPending = false
                    for (i in 0 until ticketsArr.length()) {
                        val t = ticketsArr.optJSONObject(i) ?: continue
                        val st = t.optString("status", "")
                        val sid = t.optString("sessionId", "")
                        val expMs = parseTimestampMs(t.opt("expiresAt")) ?: 0L
                        if (st == "liberado" && expMs > agoraSincronizado()) {
                            releasedTitle = t.optString("movieTitle", "")
                            releasedExpMs = expMs
                            unlockedCinemaMap[sid]?.let { prev ->
                                unlockedCinemaMap[sid] = prev.copy(expiresAtMs = expMs)
                            }
                        } else if (st == "pendente") {
                            hasPending = true
                        }
                    }

                    val timeFmt = SimpleDateFormat("HH:mm", Locale("pt", "BR"))
                    binding.txtCpfStatus.text = when {
                        releasedTitle.isNotBlank() -> {
                            binding.txtCpfStatus.setTextColor(Color.parseColor("#34D399"))
                            "CPF $cpfMasked liberado para \"$releasedTitle\" até ${timeFmt.format(Date(releasedExpMs))}."
                        }
                        hasPending -> {
                            binding.txtCpfStatus.setTextColor(Color.parseColor("#FBBF24"))
                            "CPF $cpfMasked aguardando o administrador confirmar seu Pix."
                        }
                        else -> {
                            binding.txtCpfStatus.setTextColor(Color.parseColor("#A1A1AA"))
                            "CPF $cpfMasked sem ingresso liberado. Pague o Pix e toque em 'Já fiz o Pix'."
                        }
                    }

                    renderizarListaCinema()
                    if (tabMode == TabMode.CINEMA) {
                        atualizarEstadoCinemaSincronizado(forcarPlay = forcarPlay)
                    }
                }.onFailure { err ->
                    binding.txtCpfStatus.text = err.message ?: "Erro ao verificar CPF."
                    binding.txtCpfStatus.setTextColor(Color.parseColor("#F87171"))
                }
            }
        }
    }

    private fun solicitarIngressoPixCinema(session: CinemaSession) {
        val rawCpf = binding.inputViewerCpf.text?.toString().orEmpty().replace(Regex("\\D"), "")
        val cpfDigits = if (rawCpf.length == 11) rawCpf else savedViewerCpf
        if (cpfDigits.length != 11) {
            Toast.makeText(this, "Digite seu CPF (11 dígitos) antes de avisar o Pix.", Toast.LENGTH_LONG).show()
            return
        }
        savedViewerCpf = cpfDigits
        getSharedPreferences(PREFS_VIEWER, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_VIEWER_CPF, cpfDigits)
            .apply()

        val apiBase = BuildConfig.API_BASE_URL.trim().trimEnd('/')
        if (!apiBase.startsWith("http")) return

        binding.btnRequestPixTicket.isEnabled = false
        lifecycleScope.launch(Dispatchers.IO) {
            val result = runCatching {
                val payload = JSONObject()
                    .put("cpf", cpfDigits)
                    .put("sessionId", session.id)
                    .toString()
                val req = Request.Builder()
                    .url("$apiBase/api/cinema/request-ticket")
                    .post(payload.toRequestBody("application/json; charset=utf-8".toMediaType()))
                    .build()
                client.newCall(req).execute().use { res ->
                    val bodyStr = res.body?.string().orEmpty()
                    val json = runCatching { JSONObject(bodyStr) }.getOrNull()
                    if (!res.isSuccessful) {
                        throw IllegalStateException(json?.optString("erro") ?: "Erro HTTP ${res.code}")
                    }
                    json ?: JSONObject()
                }
            }
            withContext(Dispatchers.Main) {
                binding.btnRequestPixTicket.isEnabled = true
                result.onSuccess {
                    binding.txtCpfStatus.text =
                        "Pedido enviado para \"${session.title}\" (${session.ticketPrice})! Aguarde o admin liberar seu CPF."
                    binding.txtCpfStatus.setTextColor(Color.parseColor("#FBBF24"))
                    Toast.makeText(
                        this@ViewerActivity,
                        "Pix avisado! Assim que o admin liberar seu CPF, o filme abre automaticamente.",
                        Toast.LENGTH_LONG
                    ).show()
                }.onFailure { err ->
                    binding.txtCpfStatus.text = err.message ?: "Não foi possível registrar seu Pix."
                    binding.txtCpfStatus.setTextColor(Color.parseColor("#F87171"))
                }
            }
        }
    }

    private fun parseTimestampMs(raw: Any?): Long? {
        if (raw == null || raw == JSONObject.NULL) return null
        if (raw is Number) return raw.toLong()
        val text = raw.toString().trim()
        if (text.isBlank()) return null
        text.toLongOrNull()?.let { return it }
        val patterns = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSSX",
            "yyyy-MM-dd'T'HH:mm:ssX",
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ss'Z'"
        )
        for (pattern in patterns) {
            val parsed = runCatching {
                SimpleDateFormat(pattern, Locale.US).apply {
                    timeZone = TimeZone.getTimeZone("UTC")
                }.parse(text)?.time
            }.getOrNull()
            if (parsed != null) return parsed
        }
        return null
    }

    private fun agoraSincronizado(): Long = System.currentTimeMillis() + serverClockOffsetMs

    private fun obterUrlDesbloqueada(session: CinemaSession, now: Long): Pair<String, Long> {
        if (now >= session.endTimeMs) return "" to session.endTimeMs
        val unlocked = unlockedCinemaMap[session.id]
        if (unlocked != null && now < unlocked.expiresAtMs && unlocked.videoUrl.isNotBlank()) {
            return unlocked.videoUrl to minOf(unlocked.expiresAtMs, session.endTimeMs)
        }
        if ((session.isFree || isAdminMode) && session.videoUrl.isNotBlank()) {
            return session.videoUrl to session.endTimeMs
        }
        return "" to session.endTimeMs
    }

    private fun atualizarEstadoCinemaSincronizado(forcarPlay: Boolean) {
        if (tabMode != TabMode.CINEMA) return
        val now = agoraSincronizado()
        val emCartaz = cinemaSessions.firstOrNull { now in it.startTimeMs..it.endTimeMs }

        if (emCartaz == null) {
            if (currentPlayingCinemaId != null) {
                pararCinemaPlayer()
            }
            val proximo = cinemaSessions.firstOrNull { it.startTimeMs > now }
            binding.txtViewerStatus.text = if (proximo != null) {
                val mins = ((proximo.startTimeMs - now) / 60_000L).coerceAtLeast(1L)
                "Próximo filme: ${proximo.title} (${proximo.ticketPrice}) · começa em ${mins} min"
            } else {
                "Nenhum filme em exibição agora. Confira a programação abaixo."
            }
            binding.txtViewerStatus.visibility = View.VISIBLE
            binding.txtSyncBadge.text = "Cinema · Aguardando horário"
            atualizarBotaoConectar()
            return
        }

        val (effectiveUrl, effectiveExpiry) = obterUrlDesbloqueada(emCartaz, now)
        if (effectiveUrl.isBlank() || now >= effectiveExpiry) {
            if (currentPlayingCinemaId != null) {
                pararCinemaPlayer()
            }
            binding.txtStageTitle.text = "Cinema · ${emCartaz.title}"
            binding.txtViewerStatus.text =
                "Ingresso ${emCartaz.ticketPrice}: pague o Pix e informe seu CPF abaixo para liberar até o filme acabar."
            binding.txtViewerStatus.visibility = View.VISIBLE
            binding.txtSyncBadge.text = "Ingresso bloqueado (${emCartaz.ticketPrice})"
            atualizarBotaoConectar()
            return
        }

        val elapsedSec = ((now - emCartaz.startTimeMs) / 1000L).coerceAtLeast(0L)
        binding.txtSyncBadge.text = "Em cartaz · ${formatarSegundos(elapsedSec)}"
        if (forcarPlay || currentPlayingCinemaId != emCartaz.id) {
            reproduzirSessaoCinema(emCartaz.copy(videoUrl = effectiveUrl), elapsedSec)
        }
    }

    private fun reproduzirSessaoCinema(session: CinemaSession, offsetSeconds: Long) {
        if (session.videoUrl.isBlank()) return
        currentPlayingCinemaId = session.id
        binding.txtStageTitle.text = "Cinema · ${session.title}"
        binding.txtViewerStatus.visibility = View.GONE
        atualizarBotaoConectar()

        val ytId = extrairYoutubeId(session.videoUrl)
        if (ytId != null) {
            pararVideoViewSilencioso()
            binding.videoCinema.visibility = View.GONE
            binding.webCinema.visibility = View.VISIBLE
            val muteParam = if (isMuted) 1 else 0
            val embedUrl =
                "https://www.youtube.com/embed/$ytId?autoplay=1&start=$offsetSeconds&mute=$muteParam&rel=0&modestbranding=1&playsinline=1"
            binding.webCinema.loadUrl(embedUrl)
        } else {
            binding.webCinema.loadUrl("about:blank")
            binding.webCinema.visibility = View.GONE
            binding.videoCinema.visibility = View.VISIBLE
            binding.videoCinema.setOnPreparedListener { mp ->
                cinemaMediaPlayer = mp
                aplicarVolumeCinema()
                val seekMs = (offsetSeconds * 1000L).toInt()
                if (seekMs > 2000 && mp.duration > seekMs) {
                    runCatching { mp.seekTo(seekMs) }
                }
                binding.videoCinema.start()
            }
            binding.videoCinema.setOnCompletionListener {
                currentPlayingCinemaId = null
                carregarProgramacaoCinema(forcarPlayAtivo = true)
            }
            binding.videoCinema.setOnErrorListener { _, _, _ ->
                binding.txtViewerStatus.text = "Não foi possível reproduzir este link de vídeo no aparelho."
                binding.txtViewerStatus.visibility = View.VISIBLE
                true
            }
            binding.videoCinema.setVideoURI(Uri.parse(session.videoUrl))
            binding.videoCinema.start()
        }

        renderizarListaCinema()
        reiniciarTimerAutoOcultar()
    }

    private fun aplicarVolumeCinema() {
        val vol = if (isMuted) 0f else 1f
        runCatching { cinemaMediaPlayer?.setVolume(vol, vol) }
    }

    private fun pararVideoViewSilencioso() {
        cinemaMediaPlayer = null
        runCatching {
            if (binding.videoCinema.isPlaying) {
                binding.videoCinema.stopPlayback()
            }
        }
    }

    private fun pararCinemaPlayer() {
        currentPlayingCinemaId = null
        pararVideoViewSilencioso()
        binding.videoCinema.visibility = View.GONE
        binding.webCinema.loadUrl("about:blank")
        binding.webCinema.visibility = View.GONE
        atualizarBotaoConectar()
    }

    private fun renderizarListaCinema() {
        val container = binding.cinemaScheduleContainer
        container.removeAllViews()
        val now = agoraSincronizado()
        val upcoming = cinemaSessions.filter { it.endTimeMs >= now }
        binding.txtCinemaEmpty.visibility = if (upcoming.isEmpty()) View.VISIBLE else View.GONE

        val timeFmt = SimpleDateFormat("dd/MM · HH:mm", Locale("pt", "BR"))
        for (item in upcoming) {
            val emCartaz = now in item.startTimeMs..item.endTimeMs
            val (unlockedUrl, _) = obterUrlDesbloqueada(item, now)
            val isUnlocked = unlockedUrl.isNotBlank()

            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), dp(12), dp(14), dp(12))
                background = GradientDrawable().apply {
                    cornerRadius = dp(12).toFloat()
                    setColor(if (emCartaz) Color.parseColor("#1D0B10") else Color.parseColor("#121218"))
                    setStroke(dp(1), Color.parseColor(if (emCartaz) "#C8102E" else "#27272F"))
                }
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = dp(10)
                }
            }

            val topRow = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }

            val badge = TextView(this).apply {
                text = if (emCartaz) "EM CARTAZ AGORA" else timeFmt.format(Date(item.startTimeMs))
                setTextColor(if (emCartaz) Color.parseColor("#FCA5A5") else Color.parseColor("#D4D4D8"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                setPadding(dp(8), dp(3), dp(8), dp(3))
                background = GradientDrawable().apply {
                    cornerRadius = dp(6).toFloat()
                    setColor(if (emCartaz) Color.parseColor("#7F1D1D") else Color.parseColor("#27272A"))
                }
            }

            val priceBadge = TextView(this).apply {
                text = if (item.isFree) "Grátis" else item.ticketPrice
                setTextColor(if (item.isFree || isUnlocked) Color.parseColor("#6EE7B7") else Color.parseColor("#FDE68A"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                setPadding(dp(8), dp(3), dp(8), dp(3))
                background = GradientDrawable().apply {
                    cornerRadius = dp(6).toFloat()
                    setColor(if (item.isFree || isUnlocked) Color.parseColor("#064E3B") else Color.parseColor("#78350F"))
                }
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    marginStart = dp(6)
                }
            }

            val meta = TextView(this).apply {
                text = "  ${item.genre} · ${item.durationMinutes} min"
                setTextColor(Color.parseColor("#A1A1AA"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            }

            topRow.addView(badge)
            topRow.addView(priceBadge)
            topRow.addView(meta)
            card.addView(topRow)

            val titleTv = TextView(this).apply {
                text = item.title
                setTextColor(Color.WHITE)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                setPadding(0, dp(6), 0, dp(2))
            }
            card.addView(titleTv)

            if (item.synopsis.isNotBlank()) {
                val synTv = TextView(this).apply {
                    text = item.synopsis
                    setTextColor(Color.parseColor("#A1A1AA"))
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                    maxLines = 2
                }
                card.addView(synTv)
            }

            if (emCartaz && isUnlocked) {
                val watchBtn = MaterialButton(this).apply {
                    text = if (currentPlayingCinemaId == item.id) "Reproduzindo Sincronizado" else "Assistir Agora"
                    isAllCaps = false
                    setTextColor(Color.WHITE)
                    backgroundTintList = ColorStateList.valueOf(Color.parseColor("#C8102E"))
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                        dp(38)
                    ).apply {
                        topMargin = dp(8)
                    }
                    setOnClickListener {
                        val elapsed = ((agoraSincronizado() - item.startTimeMs) / 1000L).coerceAtLeast(0L)
                        reproduzirSessaoCinema(item.copy(videoUrl = unlockedUrl), elapsed)
                    }
                }
                card.addView(watchBtn)
            } else if (!isUnlocked) {
                val pixBtn = MaterialButton(this).apply {
                    text = "Já fiz o Pix (${item.ticketPrice}) · Avisar Admin"
                    isAllCaps = false
                    setTextColor(Color.parseColor("#6EE7B7"))
                    backgroundTintList = ColorStateList.valueOf(Color.parseColor("#064E3B"))
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                        dp(38)
                    ).apply {
                        topMargin = dp(8)
                    }
                    setOnClickListener {
                        solicitarIngressoPixCinema(item)
                    }
                }
                card.addView(pixBtn)
            }

            container.addView(card)
        }
    }

    private fun extrairYoutubeId(url: String): String? {
        val regex = Regex(
            "(?:youtube\\.com/(?:watch\\?v=|embed/|shorts/|live/)|youtu\\.be/)([A-Za-z0-9_-]{11})"
        )
        return regex.find(url)?.groupValues?.getOrNull(1)
    }

    private fun formatarSegundos(totalSec: Long): String {
        val h = totalSec / 3600L
        val m = (totalSec % 3600L) / 60L
        val s = totalSec % 60L
        return if (h > 0) String.format("%d:%02d:%02d", h, m, s) else String.format("%02d:%02d", m, s)
    }

    private fun desconectarSocketSilencioso() {
        val ws = liveWebSocket
        liveWebSocket = null
        ws?.close(1000, "Desconectado")
        liberarAudioTrack()
    }

    private fun desconectar() {
        streamJob?.cancel()
        streamJob = null
        desconectarSocketSilencioso()
        decodingVideoFrame.set(false)
        hasReceivedLiveFrame = false
        atualizarBotaoConectar()
        if (tabMode == TabMode.LIVE) {
            binding.txtViewerStatus.text = "Desconectado. Toque em Conectar para assistir Ao Vivo."
            binding.txtViewerStatus.visibility = View.VISIBLE
        }
        setControlsVisible(true)
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    override fun onDestroy() {
        overlayHandler.removeCallbacks(hideControlsRunnable)
        cinemaPollJob?.cancel()
        desconectar()
        pararCinemaPlayer()
        super.onDestroy()
    }
}
