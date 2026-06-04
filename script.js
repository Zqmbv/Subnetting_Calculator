document.addEventListener('DOMContentLoaded', () => {

    // CONTROLES DE LA INTERFAZ (DOM)
    const subnetsContainer  = document.getElementById('subnets-container');
    const addSubnetBtn      = document.getElementById('add-subnet-btn');
    const form              = document.getElementById('subnet-form');
    const resultTbody       = document.getElementById('result-tbody');
    const exportCsvBtn      = document.getElementById('export-csv-btn');
    const panelOutput       = document.getElementById('panel-output');

    //region Subnet
    class Subnet {
        constructor(name, hostNeeded) {
            this.name = name;
            this.hostNeeded = parseInt(hostNeeded, 10);
            
            // Conteo de ceros a la izquierda para hallar la potencia de 2 mínima requerida
            this.exponent = 32 - Math.clz32((this.hostNeeded + 1) | 1);
            if (this.exponent < 2) this.exponent = 2; // Garantiza mínimo un CIDR /30 (2 hosts útiles)

            this.availableHosts = Math.pow(2, this.exponent);
            this.cidr = 32 - this.exponent;
            
            // Máscaras calculadas directamente con operaciones de bits
            this.maskLong = (this.cidr === 0) ? 0 : (0xFFFFFFFF << (32 - this.cidr)) >>> 0;
            this.wildcardLong = ~this.maskLong >>> 0;
            
            // Campos de red que serán rellenados por el motor VLSM/FLSM
            this.ipAddress = '';
            this.firstUsable = '';
            this.lastUsable = '';
            this.broadcast = '';
        }

        getDecMask() { return VLSM.longToIp(this.maskLong); }
        getWildcardMask() { return VLSM.longToIp(this.wildcardLong); }
    }

    // region  VLSM
    class VLSM {
        constructor(initialIpStr, initialPrefix, subnetsList, method = 'vlsm') {
            this.initialIpLong = VLSM.ipToLong(initialIpStr);
            this.initialPrefix = parseInt(initialPrefix, 10);
            this.method = method;
            
            // Mapeamos los datos crudos a instancias de nuestra clase optimizada Subnet
            this.subnets = subnetsList.map(s => new Subnet(s.name, s.hosts));
            
            if (this.method === 'vlsm') {
                // Algoritmo VLSM: Ordenar obligatoriamente de mayor a menor host requerido
                this.subnets.sort((a, b) => b.hostNeeded - a.hostNeeded);
            } else {
                // Algoritmo FLSM: Adaptar todas las subredes al tamaño de la subred más grande
                let maxHosts = Math.max(...this.subnets.map(s => s.hostNeeded));
                this.subnets = subnetsList.map(s => new Subnet(s.name, maxHosts));
                // Restauramos los nombres originales y hosts requeridos reales para la tabla visual
                subnetsList.forEach((s, idx) => {
                    this.subnets[idx].name = s.name;
                    this.subnets[idx].hostNeeded = s.hosts;
                });
            }
            
            this.adjustMainIP();
            this.calculateNetworkAddresses();
        }

        // Ajusta y alinea la IP inicial con respecto a la subred más grande
        adjustMainIP() {
            if (this.subnets.length === 0) return;
            const firstSubnet = this.subnets[0];
            this.initialIpLong = (this.initialIpLong & firstSubnet.maskLong) >>> 0;
        }

        // Realiza los saltos de red sumando desplazamientos binarios directos
        calculateNetworkAddresses() {
            let currentNetLong = this.initialIpLong;
            const maxAvailableIps = Math.pow(2, 32 - this.initialPrefix);
            let totalOffset = 0;

            for (let subnet of this.subnets) {
                if (totalOffset + subnet.availableHosts > maxAvailableIps) {
                    throw new Error(`Exceso de direccionamiento: No hay suficiente espacio en el segmento /${this.initialPrefix} para asignar los hosts de la subred "${subnet.name}".`);
                }

                subnet.ipAddress = VLSM.longToIp(currentNetLong);
                subnet.firstUsable = VLSM.longToIp(currentNetLong + 1);
                subnet.lastUsable = VLSM.longToIp(currentNetLong + subnet.availableHosts - 2);
                subnet.broadcast = VLSM.longToIp(currentNetLong + subnet.availableHosts - 1);

                // El salto de IP matemático
                currentNetLong = (currentNetLong + subnet.availableHosts) >>> 0;
                totalOffset += subnet.availableHosts;
            }
        }

        static ipToLong(ip) {
            return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
        }

        static longToIp(long) {
            return [
                (long >>> 24) & 255,
                (long >>> 16) & 255,
                (long >>> 8) & 255,
                long & 255
            ].join('.');
        }
    }

    // CONTROL DINÁMICO DE FILAS (SUBREDES) DE INTERFAZ
    function recalculateIDs() {
        const rows = subnetsContainer.querySelectorAll('.subnets-input');
        rows.forEach((row, index) => {
            const id = index + 1;
            row.querySelector('h3').innerText = id;
            
            const inputs = row.querySelectorAll('input');
            inputs[0].setAttribute('id', `subnet-name-${id}`);
            inputs[0].setAttribute('placeholder', `Ej: LAN Subred ${id}`);
            inputs[1].setAttribute('id', `subnet-hosts-${id}`);
            
            const labels = row.querySelectorAll('label');
            if (labels.length >= 2) {
                labels[0].setAttribute('for', `subnet-name-${id}`);
                labels[0].innerText = `Nombre Subred ${id}`;
                labels[1].setAttribute('for', `subnet-hosts-${id}`);
                labels[1].innerText = `Hosts Requeridos Subred ${id}`;
            }

            const btn = row.querySelector('.btn-erase');
            if (btn) btn.setAttribute('aria-label', `Eliminar subred ${id}`);
        });
    }

    addSubnetBtn.addEventListener('click', () => {
        const count = subnetsContainer.querySelectorAll('.subnets-input').length + 1;

        const newRow = document.createElement('div');
        newRow.className = 'subnets-input';
        newRow.innerHTML = `
            <h3>${count}</h3>
            <label class="sr-only" for="subnet-name-${count}">Nombre Subred ${count}</label>
            <input type="text" id="subnet-name-${count}" maxlength="24" placeholder="Ej: LAN Subred ${count}" value="LAN Subred ${count}" required>
            <label class="sr-only" for="subnet-hosts-${count}">Hosts Requeridos Subred ${count}</label>
            <input type="number" id="subnet-hosts-${count}" placeholder="Ej: 150" min="1" max="4294967296" required value="150">
            <button class="btn-erase" type="button" aria-label="Eliminar subred ${count}"><span class="material-symbols-outlined">delete</span></button>
        `;

        subnetsContainer.appendChild(newRow);
        subnetsContainer.scrollTop = subnetsContainer.scrollHeight;
    });

    subnetsContainer.addEventListener('click', (e) => {
        const eraseBtn = e.target.closest('.btn-erase');
        
        if (eraseBtn) {
            eraseBtn.closest('.subnets-input').remove();
            recalculateIDs();
        }
    });

    // Restablece la tabla al mensaje de estado vacío inicial
    function setTableEmptyMessage() {
        resultTbody.innerHTML = `
            <tr>
                <td colspan="11" class="txt-center empty-msg"> Introduce las subredes y haz clic en "Calcular" para generar resultados.
                </td>
            </tr>
        `;
    }

    //region PROCESO

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const ipInput = document.getElementById('initial-ip').value.trim();
        const cidrInput = parseInt(document.getElementById('initial-cidr').value, 10);
        const method = document.querySelector('input[name="method"]:checked').value;

        const ipRegex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        if (!ipRegex.test(ipInput)) {
            alert("Error de Entrada: Por favor, ingresa una dirección IP base válida.");
            panelOutput.classList.remove('visible-on-mobile');
            setTableEmptyMessage();
            return;
        }

        const subnetRows = subnetsContainer.querySelectorAll('.subnets-input');
        let subnetsData = [];
        let hasHostInputError = false;

        subnetRows.forEach((row) => {
            const name = row.querySelector('input[type="text"]').value.trim();
            const hosts = parseInt(row.querySelector('input[type="number"]').value, 10);

            if (isNaN(hosts) || hosts < 1) {
                hasHostInputError = true;
            }
            subnetsData.push({ name, hosts });
        });

        if (subnetsData.length === 0) {
            alert("Configuración incompleta: Por favor, agrega al menos una subred utilizando el botón 'Agregar'.");
            panelOutput.classList.remove('visible-on-mobile');
            setTableEmptyMessage();
            return;
        }

        if (hasHostInputError) {
            alert("Campos inválidos: Por favor, introduce una cantidad de hosts válida (mínimo 1) para todas las filas.");
            panelOutput.classList.remove('visible-on-mobile');
            setTableEmptyMessage();
            return;
        }

        try {
            const ejecutorRed = new VLSM(ipInput, cidrInput, subnetsData, method);
            
            let resultsHTML = '';
            ejecutorRed.subnets.forEach((sub, index) => {
                resultsHTML += `
                    <tr>
                        <td>${sub.name}</td>
                        <td class="txt-center">${sub.hostNeeded}</td>
                        <td class="txt-center">${sub.availableHosts - 2}</td>
                        <td class="txt-center">${sub.cidr}</td>
                        <td>${sub.getDecMask()}</td>
                        <td>${sub.getWildcardMask()}</td>
                        <td>${sub.ipAddress}</td>
                        <td>${sub.firstUsable}</td>
                        <td>${sub.lastUsable}</td>
                        <td>${sub.broadcast}</td>
                    </tr>
                `;
            });

            resultTbody.innerHTML = resultsHTML;
            panelOutput.classList.add('visible-on-mobile');
            panelOutput.scrollIntoView({ behavior: 'smooth' });

        } catch (error) {
            alert(error.message);
            
            panelOutput.classList.remove('visible-on-mobile');
            setTableEmptyMessage();
        }
    });

    //region EXPORT
    exportCsvBtn.addEventListener('click', () => {
        const rows = resultTbody.querySelectorAll('tr');
        if (rows.length === 0 || rows[0].classList.contains('empty-table-row')) {
            alert("Exportación denegada: No existen cálculos válidos en pantalla para exportar.");
            return;
        }

        let csvContent = "\uFEFF";
        const headers = ["Subred", "Hosts Requeridos", "Hosts Asignados", "CIDR", "Mascara", "Mascara Wildcard", "Direccion IP", "Primera Util", "Ultima Util", "Broadcast"];
        csvContent += headers.map(h => `"${h}"`).join(";") + "\r\n";

        rows.forEach((row) => {
            const cols = row.querySelectorAll('td');
            const rowData = Array.from(cols).map(c => `"${c.innerText.trim().replace(/\n/g, ' ')}"`).join(";");
            csvContent += rowData + "\r\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "Resultados_Subnetting.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
});