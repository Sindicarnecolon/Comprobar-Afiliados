/**
 * ============================================================
 *  Web de Comprobación de Estado de Afiliados
 *  Mi Credencial Online
 *  Motor de Consulta Manual + Verificación de Códigos QR
 *  Integración con Lector QR por Cámara (FASE C)
 * ============================================================
 */

const API_URL = 'https://script.google.com/macros/s/AKfycbzwlmFPZRNYVtnGzGegkwC6ozoyDu9OEc0kauSa-kCGUMuZieU9vN8k86l9NemhJsCZ/exec';

// ============================================================
// 1. FLUJO MANUAL DE CONSULTA POR DNI (PRESERVADO AL 100%)
// ============================================================

/**
 * Maneja el envío del formulario de consulta manual
 */
async function handleCheckSubmit(event) {
    event.preventDefault();

    const input = document.getElementById('dni-input');
    const rawValue = String(input.value || '').trim();

    // DNI tratado estrictamente como CADENA DE TEXTO / IDENTIFICADOR (solo dígitos)
    const cleanDni = rawValue.replace(/\D/g, '');

    if (!cleanDni) {
        showToast('Por favor, ingrese un número de DNI válido.');
        input.focus();
        return;
    }

    setLoading(true);

    try {
        // Consulta por DNI al Apps Script
        let response = await fetch(`${API_URL}?dni=${encodeURIComponent(cleanDni)}`);
        if (!response.ok) {
            throw new Error(`HTTP Error ${response.status}`);
        }
        let data = await response.json();

        // Si la versión actual del script requiere nombre, reintentar con comodín '*'
        if (!data.success && data.message && (data.message.includes('faltantes') || data.message.includes('obligatorios'))) {
            response = await fetch(`${API_URL}?dni=${encodeURIComponent(cleanDni)}&nombre=*`);
            if (response.ok) {
                data = await response.json();
            }
        }

        processResult(data);
    } catch (error) {
        console.error('[ComprobarAfiliados] Error de consulta:', error);
        showModal(
            'state-error',
            'ERROR DE CONEXIÓN',
            'cloud_off',
            'No fue posible realizar la comprobación. Verifique su conexión e intente nuevamente.'
        );
    } finally {
        setLoading(false);
    }
}

/**
 * Procesa la respuesta de Google Sheets y determina el estado para consulta manual
 */
function processResult(data) {
    // 1. Detectar duplicados o inconsistencia explícita
    if (data.duplicate === true || (data.message && (data.message.includes('duplicad') || data.message.includes('múltiples')))) {
        showModal(
            'state-error',
            'NO DETERMINADO',
            'warning',
            'No se pudo determinar el estado del afiliado debido a registros múltiples.'
        );
        return;
    }

    // 2. Afiliado encontrado
    if (data.success === true) {
        const vtoRaw = data.vto || '';
        
        if (!vtoRaw) {
            showModal(
                'state-error',
                'SIN FECHA VTO',
                'help',
                'El afiliado figura registrado pero no posee fecha de vencimiento configurada.'
            );
            return;
        }

        const expirationEnd = parseExpirationDate(vtoRaw);

        if (!expirationEnd) {
            showModal(
                'state-error',
                'FECHA INVÁLIDA',
                'event_busy',
                'No se pudo interpretar la fecha de vencimiento del afiliado.'
            );
            return;
        }

        const now = new Date();

        if (now <= expirationEnd) {
            showModal(
                'state-activo',
                'ACTIVO',
                'check_circle',
                'El afiliado se encuentra con su credencial vigente.'
            );
        } else {
            showModal(
                'state-inactivo',
                'INACTIVO',
                'cancel',
                'La credencial del afiliado se encuentra vencida.'
            );
        }
        return;
    }

    // 3. Afiliado no encontrado
    showModal(
        'state-notfound',
        'AFILIADO NO ENCONTRADO',
        'person_search',
        'El DNI ingresado no figura en el registro de afiliados.'
    );
}

// ============================================================
// 2. CONTROLADOR DEL ESCÁNER QR POR CÁMARA (FASE C)
// ============================================================

let html5QrCodeScanner = null;
let isScannerActive = false;
let isProcessingScan = false;

/**
 * Abre el visor e inicializa la cámara para escanear el QR
 */
async function openQrScanner() {
    const modal = document.getElementById('qr-scanner-modal');
    const statusMsg = document.getElementById('scanner-status-msg');
    
    if (!modal) return;
    
    if (typeof Html5Qrcode === 'undefined') {
        showToast('El módulo de escáner QR no se encuentra disponible.');
        return;
    }

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
    
    if (statusMsg) {
        statusMsg.textContent = 'Iniciando cámara...';
    }

    isProcessingScan = false;

    try {
        if (!html5QrCodeScanner) {
            html5QrCodeScanner = new Html5Qrcode('qr-reader');
        }

        const qrConfig = {
            fps: 10,
            qrbox: function(viewfinderWidth, viewfinderHeight) {
                const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                const edgeSize = Math.floor(minEdge * 0.75);
                return { width: edgeSize, height: edgeSize };
            },
            aspectRatio: 1.0
        };

        // Preferir cámara trasera del dispositivo móvil
        await html5QrCodeScanner.start(
            { facingMode: 'environment' },
            qrConfig,
            onQrCodeSuccess,
            onQrCodeError
        );

        isScannerActive = true;
        if (statusMsg) {
            statusMsg.textContent = 'Enfoque el código QR de la credencial dentro del recuadro';
        }
    } catch (err) {
        console.error('[Scanner QR] Error al acceder a la cámara:', err);
        isScannerActive = false;
        
        let userMessage = 'No fue posible acceder a la cámara.';
        const errStr = String(err).toLowerCase();
        if (errStr.includes('notallowederror') || errStr.includes('permission')) {
            userMessage = 'Permiso de cámara denegado. Habilite el acceso para escanear.';
        } else if (errStr.includes('notfounderror') || errStr.includes('devicesnotfound')) {
            userMessage = 'No se detectó ninguna cámara disponible en el dispositivo.';
        } else if (errStr.includes('notsupportederror') || !window.isSecureContext) {
            userMessage = 'El escaneo por cámara requiere conexión segura (HTTPS).';
        }

        if (statusMsg) {
            statusMsg.textContent = userMessage;
        }
        showToast(userMessage);
    }
}

/**
 * Callback ejecutado al leer exitosamente un código QR
 */
async function onQrCodeSuccess(decodedText, decodedResult) {
    if (isProcessingScan) return; // Prevenir lecturas múltiples simultáneas
    isProcessingScan = true;

    // 1. Detener cámara y cerrar visor inmediatamente
    await closeQrScanner();

    // 2. Entregar el contenido directamente al motor existente de la FASE B1
    handleQrPayload(decodedText);
}

/**
 * Callback de error por frame (ignorado durante el barrido continuo)
 */
function onQrCodeError(errorMessage) {
    // Normal mientras no se enfoca un código
}

/**
 * Detiene la cámara y cierra el visor liberando todos los recursos
 */
async function closeQrScanner() {
    const modal = document.getElementById('qr-scanner-modal');
    
    if (html5QrCodeScanner && isScannerActive) {
        try {
            await html5QrCodeScanner.stop();
        } catch (e) {
            console.warn('[Scanner QR] Advertencia al detener scanner:', e);
        }
        isScannerActive = false;
    }

    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 250);
    }
}

function closeQrScannerOnOverlay(event) {
    if (event.target.id === 'qr-scanner-modal') {
        closeQrScanner();
    }
}

// ============================================================
// 3. MOTOR DE VERIFICACIÓN DE CÓDIGO QR (FASE B1 / C)
// ============================================================

/**
 * Normaliza cadenas de texto para comparación segura
 */
function normalizeText(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ');
}

/**
 * Normaliza número de afiliado preservando caracteres como '/'
 */
function normalizeAffiliateNumber(affiliate) {
    if (affiliate === null || affiliate === undefined) return '';
    return String(affiliate).trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Normaliza fechas a formato ISO YYYY-MM-DD
 */
function normalizeToIsoDate(vtoStr) {
    if (!vtoStr) return '';
    const d = parseExpirationDate(vtoStr);
    if (!d || isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Valida y parsea la cadena JSON del QR de forma controlada
 */
function parseQrPayload(rawInput) {
    if (rawInput === null || rawInput === undefined) {
        return { valid: false, error: 'No se recibieron datos de código QR.' };
    }

    let parsed;
    if (typeof rawInput === 'object') {
        parsed = rawInput;
    } else if (typeof rawInput === 'string') {
        const trimmed = rawInput.trim();
        if (!trimmed) {
            return { valid: false, error: 'El contenido del código QR está vacío.' };
        }
        try {
            parsed = JSON.parse(trimmed);
        } catch (e) {
            return { valid: false, error: 'El contenido no es un JSON válido.' };
        }
    } else {
        return { valid: false, error: 'Tipo de dato de QR no soportado.' };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { valid: false, error: 'Estructura de QR no válida.' };
    }

    // Comprobar campos obligatorios
    const requiredFields = ['dni', 'nombre', 'afiliado', 'establecimiento', 'vto'];
    for (const field of requiredFields) {
        if (!(field in parsed) || parsed[field] === null || parsed[field] === undefined) {
            return { valid: false, error: `Campo obligatorio ausente en el QR: "${field}".` };
        }
    }

    const dniStr = String(parsed.dni).trim();
    const cleanDni = dniStr.replace(/\D/g, '');
    if (!cleanDni || !/^\d{6,12}$/.test(cleanDni)) {
        return { valid: false, error: 'El campo DNI en el QR no contiene un formato numérico válido.' };
    }

    const nombreStr = String(parsed.nombre).trim();
    if (!nombreStr) {
        return { valid: false, error: 'El campo nombre en el QR está vacío.' };
    }

    const afiliadoStr = String(parsed.afiliado).trim();
    if (!afiliadoStr) {
        return { valid: false, error: 'El campo número de afiliado en el QR está vacío.' };
    }

    const estabStr = String(parsed.establecimiento).trim();
    if (!estabStr) {
        return { valid: false, error: 'El campo establecimiento en el QR está vacío.' };
    }

    const vtoStr = String(parsed.vto).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vtoStr) && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(vtoStr) && !/^\d{1,2}\/\d{4}$/.test(vtoStr)) {
        return { valid: false, error: 'El campo fecha de vencimiento en el QR no posee un formato reconocido.' };
    }

    return {
        valid: true,
        payload: {
            dni: cleanDni,
            nombre: nombreStr,
            afiliado: afiliadoStr,
            establecimiento: estabStr,
            vto: vtoStr
        }
    };
}

/**
 * Punto de entrada principal para procesar y verificar un código QR (JSON)
 */
async function handleQrPayload(rawJson) {
    const parseResult = parseQrPayload(rawJson);

    // 1. Si el QR no contiene una estructura válida, mostrar error sin consultar backend
    if (!parseResult.valid) {
        showQrResultModal({
            status: 'INVALID_QR',
            title: 'CREDENCIAL NO VÁLIDA',
            message: parseResult.error,
            checks: null
        });
        return { success: false, reason: parseResult.error };
    }

    const qrData = parseResult.payload;
    const cleanDni = qrData.dni;

    setQrLoading(true);

    try {
        // 2. Reutilizar la consulta exacta existente al Google Apps Script
        let response = await fetch(`${API_URL}?dni=${encodeURIComponent(cleanDni)}`);
        if (!response.ok) {
            throw new Error(`HTTP Error ${response.status}`);
        }
        let dbData = await response.json();

        // Fallback transparente si se solicita nombre
        if (!dbData.success && dbData.message && (dbData.message.includes('faltantes') || dbData.message.includes('obligatorios'))) {
            response = await fetch(`${API_URL}?dni=${encodeURIComponent(cleanDni)}&nombre=*`);
            if (response.ok) {
                dbData = await response.json();
            }
        }

        // 3. Comparar los datos del QR contra la respuesta de la base de datos
        return verifyQrAgainstDb(qrData, dbData, cleanDni);
    } catch (error) {
        console.error('[ComprobarAfiliados - QR] Error de consulta:', error);
        showQrResultModal({
            status: 'CONNECTION_ERROR',
            title: 'ERROR DE CONEXIÓN',
            message: 'No fue posible realizar la comprobación contra la base de datos. Verifique su conexión.',
            checks: null
        });
        return { success: false, reason: 'Error de conexión' };
    } finally {
        setQrLoading(false);
    }
}

/**
 * Compara los datos del QR contra los devueltos por Google Apps Script
 */
function verifyQrAgainstDb(qrPayload, dbData, queriedDni) {
    // 1. Caso Duplicados / Inconsistencia en la base
    if (dbData.duplicate === true || (dbData.message && (dbData.message.includes('duplicad') || dbData.message.includes('múltiples')))) {
        showQrResultModal({
            status: 'DUPLICATE',
            title: 'NO DETERMINADO',
            message: 'No se pudo validar la credencial debido a registros múltiples en la base de datos.',
            checks: null
        });
        return { success: false, reason: 'Registros duplicados en base de datos' };
    }

    // 2. Caso Afiliado no encontrado en la base
    if (!dbData.success) {
        showQrResultModal({
            status: 'NOT_FOUND',
            title: 'CREDENCIAL NO VÁLIDA',
            message: 'El DNI de la credencial no figura en el registro oficial de afiliados.',
            checks: {
                dni: false,
                active: false,
                nombre: false,
                afiliado: false,
                establecimiento: false,
                vto: false
            }
        });
        return { success: false, reason: 'Afiliado no encontrado' };
    }

    // 3. Afiliado encontrado: evaluar vigencia
    const vtoDbRaw = dbData.vto || '';
    const expirationEnd = parseExpirationDate(vtoDbRaw);
    const now = new Date();
    const isDateValid = expirationEnd !== null && !isNaN(expirationEnd.getTime());
    const isNotExpired = isDateValid && now <= expirationEnd;

    // 4. Comparar cada campo
    const dniMatches = queriedDni === qrPayload.dni;
    const nameMatches = normalizeText(qrPayload.nombre) === normalizeText(dbData.nombre);
    const affiliateMatches = normalizeAffiliateNumber(qrPayload.afiliado) === normalizeAffiliateNumber(dbData.nroAfiliado);
    const establishmentMatches = normalizeText(qrPayload.establecimiento) === normalizeText(dbData.establecimiento);
    
    // Comparación de fechas normalizadas ISO (YYYY-MM-DD)
    const qrIsoDate = normalizeToIsoDate(qrPayload.vto);
    const dbIsoDate = normalizeToIsoDate(vtoDbRaw);
    const vtoMatches = qrIsoDate !== '' && dbIsoDate !== '' && qrIsoDate === dbIsoDate;

    const checks = {
        active: isNotExpired,
        dni: dniMatches,
        nombre: nameMatches,
        afiliado: affiliateMatches,
        establecimiento: establishmentMatches,
        vto: vtoMatches
    };

    const allMatch = checks.active && checks.dni && checks.nombre && checks.afiliado && checks.establecimiento && checks.vto;

    if (allMatch) {
        showQrResultModal({
            status: 'VALID',
            title: 'CREDENCIAL VÁLIDA',
            message: 'Todos los datos coinciden con el registro oficial y la credencial está vigente.',
            checks: checks,
            data: dbData
        });
        return { success: true, checks: checks };
    }

    // Determinar motivo descriptivo del fallo
    let failureReason = 'Los datos presentados no coinciden con los registros actuales.';
    if (!isNotExpired) {
        failureReason = 'La credencial se encuentra vencida en el registro oficial.';
    } else if (!nameMatches) {
        failureReason = 'El nombre de la credencial no coincide con el registro oficial.';
    } else if (!affiliateMatches) {
        failureReason = 'El número de afiliado no coincide con el registro oficial.';
    } else if (!establishmentMatches) {
        failureReason = 'El establecimiento indicado no coincide con el registro oficial.';
    } else if (!vtoMatches) {
        failureReason = 'La fecha de vencimiento no coincide con el registro oficial.';
    }

    showQrResultModal({
        status: 'INVALID',
        title: 'CREDENCIAL NO VÁLIDA',
        message: failureReason,
        checks: checks,
        data: dbData
    });

    return { success: false, reason: failureReason, checks: checks };
}

/**
 * Renderiza el modal de resultados específico para verificación QR
 */
function showQrResultModal(result) {
    const modal = document.getElementById('result-modal');
    const card = modal.querySelector('.modal-card');
    const icon = document.getElementById('status-icon');
    const statusEl = document.getElementById('status-text');
    const msgEl = document.getElementById('modal-message');
    const checklistContainer = document.getElementById('qr-checklist-container');

    // Limpiar clases
    card.className = 'modal-card';

    if (result.status === 'VALID') {
        card.classList.add('state-activo');
        icon.textContent = 'verified_user';
        statusEl.textContent = 'CREDENCIAL VÁLIDA';
    } else if (result.status === 'DUPLICATE' || result.status === 'CONNECTION_ERROR') {
        card.classList.add('state-error');
        icon.textContent = result.status === 'CONNECTION_ERROR' ? 'cloud_off' : 'warning';
        statusEl.textContent = result.title;
    } else {
        card.classList.add('state-inactivo');
        icon.textContent = 'gpp_bad';
        statusEl.textContent = 'CREDENCIAL NO VÁLIDA';
    }

    msgEl.textContent = result.message;

    // Renderizar checklist si existen comparaciones
    if (result.checks && checklistContainer) {
        checklistContainer.style.display = 'flex';
        checklistContainer.innerHTML = `
            <div class="checklist-grid">
                <div class="check-item ${result.checks.active ? 'pass' : 'fail'}">
                    <span class="material-symbols-outlined">${result.checks.active ? 'check_circle' : 'cancel'}</span>
                    <span>Vigencia activa</span>
                </div>
                <div class="check-item ${result.checks.dni ? 'pass' : 'fail'}">
                    <span class="material-symbols-outlined">${result.checks.dni ? 'check_circle' : 'cancel'}</span>
                    <span>DNI verificado</span>
                </div>
                <div class="check-item ${result.checks.nombre ? 'pass' : 'fail'}">
                    <span class="material-symbols-outlined">${result.checks.nombre ? 'check_circle' : 'cancel'}</span>
                    <span>Nombre y Apellido</span>
                </div>
                <div class="check-item ${result.checks.afiliado ? 'pass' : 'fail'}">
                    <span class="material-symbols-outlined">${result.checks.afiliado ? 'check_circle' : 'cancel'}</span>
                    <span>N° de Afiliado</span>
                </div>
                <div class="check-item ${result.checks.establecimiento ? 'pass' : 'fail'}">
                    <span class="material-symbols-outlined">${result.checks.establecimiento ? 'check_circle' : 'cancel'}</span>
                    <span>Establecimiento</span>
                </div>
                <div class="check-item ${result.checks.vto ? 'pass' : 'fail'}">
                    <span class="material-symbols-outlined">${result.checks.vto ? 'check_circle' : 'cancel'}</span>
                    <span>Fecha de Vencimiento</span>
                </div>
            </div>
        `;
    } else if (checklistContainer) {
        checklistContainer.style.display = 'none';
        checklistContainer.innerHTML = '';
    }

    modal.classList.add('active');
}

// ============================================================
// 4. UTILIDADES GENERALES Y MANEJO DEL DOM
// ============================================================

/**
 * Convierte un string de fecha en un objeto Date a las 23:59:59.999
 */
function parseExpirationDate(vtoStr) {
    if (!vtoStr) return null;

    let raw = String(vtoStr).replace(/^Vto:\s*/i, '').replace(/\s*\(.*?\)/g, '').trim();

    // Formato DD/MM/YYYY (ej: 10/08/2026)
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
        const parts = raw.split('/');
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);
        if (isValidDateParts(day, month, year)) {
            return new Date(year, month - 1, day, 23, 59, 59, 999);
        }
    }

    // Formato MM/YYYY (ej: 08/2026 -> último día del mes)
    if (/^\d{1,2}\/\d{4}$/.test(raw)) {
        const parts = raw.split('/');
        const month = parseInt(parts[0], 10);
        const year = parseInt(parts[1], 10);
        if (month >= 1 && month <= 12 && year > 1900) {
            return new Date(year, month, 0, 23, 59, 59, 999);
        }
    }

    // Formato ISO YYYY-MM-DD (ej: 2026-08-10)
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        const datePart = raw.split('T')[0];
        const parts = datePart.split('-');
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        if (isValidDateParts(day, month, year)) {
            return new Date(year, month - 1, day, 23, 59, 59, 999);
        }
    }

    // Fallback: Date constructor estándar
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    }

    return null;
}

function isValidDateParts(day, month, year) {
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;
    if (year < 1900 || year > 2100) return false;
    return true;
}

/**
 * Controla el estado de carga del formulario manual
 */
function setLoading(loading) {
    const btn = document.getElementById('btn-submit');
    const text = document.getElementById('btn-text');
    const spinner = document.getElementById('btn-spinner');
    const input = document.getElementById('dni-input');

    if (loading) {
        btn.disabled = true;
        input.disabled = true;
        text.style.display = 'none';
        spinner.style.display = 'block';
    } else {
        btn.disabled = false;
        input.disabled = false;
        text.style.display = 'block';
        spinner.style.display = 'none';
    }
}

/**
 * Controla el estado de carga del panel de prueba QR
 */
function setQrLoading(loading) {
    const btn = document.getElementById('btn-qr-verify');
    const text = document.getElementById('btn-qr-text');
    const spinner = document.getElementById('btn-qr-spinner');
    const textarea = document.getElementById('qr-json-input');

    if (!btn) return;

    if (loading) {
        btn.disabled = true;
        if (textarea) textarea.disabled = true;
        if (text) text.style.display = 'none';
        if (spinner) spinner.style.display = 'block';
    } else {
        btn.disabled = false;
        if (textarea) textarea.disabled = false;
        if (text) text.style.display = 'block';
        if (spinner) spinner.style.display = 'none';
    }
}

/**
 * Muestra el modal para la consulta manual
 */
function showModal(stateClass, statusText, iconName, messageText) {
    const modal = document.getElementById('result-modal');
    const card = modal.querySelector('.modal-card');
    const icon = document.getElementById('status-icon');
    const statusEl = document.getElementById('status-text');
    const msgEl = document.getElementById('modal-message');
    const checklistContainer = document.getElementById('qr-checklist-container');

    if (checklistContainer) {
        checklistContainer.style.display = 'none';
        checklistContainer.innerHTML = '';
    }

    card.className = 'modal-card ' + stateClass;
    icon.textContent = iconName;
    statusEl.textContent = statusText;
    msgEl.textContent = messageText;

    modal.classList.add('active');
}

/**
 * Cierra el modal de respuesta
 */
function closeModal() {
    const modal = document.getElementById('result-modal');
    modal.classList.remove('active');
    
    const input = document.getElementById('dni-input');
    if (input) {
        input.value = '';
        setTimeout(() => {
            input.focus();
        }, 200);
    }
}

function closeModalOnOverlay(event) {
    if (event.target.id === 'result-modal') {
        closeModal();
    }
}

/**
 * Alterna la visibilidad del panel de prueba de JSON QR
 */
function toggleQrTestPanel() {
    const content = document.getElementById('qr-test-content');
    const arrow = document.getElementById('qr-test-arrow');
    if (!content) return;

    if (content.style.display === 'none' || content.style.display === '') {
        content.style.display = 'block';
        if (arrow) arrow.textContent = 'expand_less';
        const textarea = document.getElementById('qr-json-input');
        if (textarea) setTimeout(() => textarea.focus(), 150);
    } else {
        content.style.display = 'none';
        if (arrow) arrow.textContent = 'expand_more';
    }
}

/**
 * Maneja el botón de verificación del panel de prueba QR
 */
function handleQrFormSubmit() {
    const textarea = document.getElementById('qr-json-input');
    if (!textarea) return;
    const rawVal = textarea.value;
    handleQrPayload(rawVal);
}

/**
 * Muestra una notificación Toast flotante
 */
let toastTimeout;
function showToast(message) {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toast-message');
    
    msg.textContent = message;
    toast.classList.add('show');

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Exponer en el ámbito global para interoperabilidad y pruebas
window.openQrScanner = openQrScanner;
window.closeQrScanner = closeQrScanner;
window.closeQrScannerOnOverlay = closeQrScannerOnOverlay;
window.onQrCodeSuccess = onQrCodeSuccess;
window.onQrCodeError = onQrCodeError;
window.handleQrPayload = handleQrPayload;
window.verifyQrAgainstDb = verifyQrAgainstDb;
window.parseQrPayload = parseQrPayload;
window.normalizeText = normalizeText;
window.normalizeAffiliateNumber = normalizeAffiliateNumber;
window.normalizeToIsoDate = normalizeToIsoDate;
