/**
 * ============================================================
 *  Web de Comprobación de Estado de Afiliados
 *  Sindicato de la Carne, Colón
 * ============================================================
 */

const API_URL = 'https://script.google.com/macros/s/AKfycbzwlmFPZRNYVtnGzGegkwC6ozoyDu9OEc0kauSa-kCGUMuZieU9vN8k86l9NemhJsCZ/exec';

/**
 * Maneja el envío del formulario de consulta
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
 * Procesa la respuesta de Google Sheets y determina el estado
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

/**
 * Convierte un string de fecha (DD/MM/YYYY, MM/YYYY, YYYY-MM-DD)
 * en un objeto Date representando el ÚLTIMO MILISEGUNDO del día de vencimiento.
 * Esto garantiza que el afiliado siga ACTIVO durante todo el día indicado.
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

    // Formato MM/YYYY (ej: 08/2026 -> vigencia hasta el último día del mes a las 23:59:59)
    if (/^\d{1,2}\/\d{4}$/.test(raw)) {
        const parts = raw.split('/');
        const month = parseInt(parts[0], 10);
        const year = parseInt(parts[1], 10);
        if (month >= 1 && month <= 12 && year > 1900) {
            // El día 0 del mes siguiente es el último día del mes actual
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
 * Controla el estado de carga (Spinner y deshabilitación del botón)
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
 * Muestra el modal con el resultado
 */
function showModal(stateClass, statusText, iconName, messageText) {
    const modal = document.getElementById('result-modal');
    const card = modal.querySelector('.modal-card');
    const icon = document.getElementById('status-icon');
    const statusEl = document.getElementById('status-text');
    const msgEl = document.getElementById('modal-message');

    // Limpiar clases de estado anteriores
    card.className = 'modal-card ' + stateClass;

    icon.textContent = iconName;
    statusEl.textContent = statusText;
    msgEl.textContent = messageText;

    modal.classList.add('active');
}

/**
 * Cierra el modal de respuesta y resetea el campo DNI
 */
function closeModal() {
    const modal = document.getElementById('result-modal');
    modal.classList.remove('active');
    
    const input = document.getElementById('dni-input');
    input.value = '';
    setTimeout(() => {
        input.focus();
    }, 200);
}

function closeModalOnOverlay(event) {
    if (event.target.id === 'result-modal') {
        closeModal();
    }
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
