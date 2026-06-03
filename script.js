document.addEventListener('DOMContentLoaded', () => {
    const subnetsContainer  = document.getElementById('subnets-container');
    const addSubnetBtn      = document.getElementById('add-subnet-btn');
    const form              = document.getElementById('subnet-form');
    const resultTbody       = document.getElementById('result-tbody');
    const exportCsvBtn      = document.getElementById('export-csv-btn');
    const panelOutput       = document.getElementById('panel-output');

    // ======= 1. AGREGAR / ELIMINAR ELEMENTOS DINÁMICAMENTE =======

    // Recalcula IDs visuales y asocia labels de accesibilidad
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
            if (btn) {
                btn.setAttribute('aria-label', `Eliminar subred ${id}`);
            }
        });
    }

    // Añadir nueva fila
    addSubnetBtn.addEventListener('click', () => {
        const count = subnetsContainer.querySelectorAll('.subnets-input').length + 1;

        const newRow = document.createElement('div');
        newRow.className = 'subnets-input';
        newRow.innerHTML = `
            <h3>${count}</h3>
            <label class="sr-only" for="subnet-name-${count}">Nombre Subred ${count}</label>
            <input type="text" id="subnet-name-${count}" maxlength="24" placeholder="Ej: LAN Subred ${count}" value="LAN Subred ${count}" required>
            <label class="sr-only" for="subnet-hosts-${count}">Hosts Requeridos Subred ${count}</label>
            <input type="number" id="subnet-hosts-${count}" placeholder="Ej: 150" min="1" max="4294967296" required>
            <button class="btn-erase" type="button" aria-label="Eliminar subred ${count}">X</button>
        `;

        subnetsContainer.appendChild(newRow);
        subnetsContainer.scrollTop = subnetsContainer.scrollHeight; // Auto-scroll
    });

    // Eliminar filas
    subnetsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-erase')) {
            const row = e.target.closest('.subnets-input');
            row.remove();
            recalculateIDs();
        }
    });


    // ======= 2. MOTOR LÓGICO DE CALCULOS DE RED (IP HELPER) =======

    function ipToLong(ip) {
        return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
    }

    function longToIp(long) {
        return [
            (long >>> 24) & 255,
            (long >>> 16) & 255,
            (long >>> 8) & 255,
            long & 255
        ].join('.');
    }

    function getWildcard(cidr) {
        let mask = (0xFFFFFFFF << (32 - cidr)) >>> 0;
        return longToIp(~mask >>> 0);
    }

    function cidrToMask(cidr) {
        if (cidr === 0) return "0.0.0.0";
        let mask = (0xFFFFFFFF << (32 - cidr)) >>> 0;
        return longToIp(mask);
    }


    // ======= 3. EVENTO DE CALCULO PRINCIPAL =======

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const ipInput = document.getElementById('initial-ip').value.trim();
        const cidrInput = parseInt(document.getElementById('initial-cidr').value, 10);
        const method = document.querySelector('input[name="method"]:checked').value;

        // Validar formato IP
        const ipRegex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        if (!ipRegex.test(ipInput)) {
            alert("Por favor, ingresa una dirección IP base válida.");
            return;
        }

        // Recolectar datos de las subredes
        const subnetRows = subnetsContainer.querySelectorAll('.subnets-input');
        let subnets = [];
        let hasError = false;

        subnetRows.forEach((row) => {
            const name = row.querySelector('input[type="text"]').value.trim();
            const hosts = parseInt(row.querySelector('input[type="number"]').value, 10);
            const id = row.querySelector('h3').innerText;

            if (isNaN(hosts) || hosts < 1) {
                hasError = true;
            }

            subnets.push({ id, name, hosts });
        });

        if (subnets.length === 0) {
            alert("Por favor, agrega al menos una subred utilizando el botón 'Agregar'.");
            return;
        }

        if (hasError) {
            alert("Por favor, introduce una cantidad de hosts válida (mínimo 1) para todas las filas.");
            return;
        }

        // Parámetros iniciales
        let baseIpLong = ipToLong(ipInput);
        const maxAvailableIps = Math.pow(2, 32 - cidrInput);
        let currentOffset = 0;

        // Estructura para acumular los cálculos de fila
        let resultsHTML = '';

        if (method === 'vlsm') {
            // Algoritmo VLSM: Ordenar de mayor a menor host para optimizar direccionamiento
            subnets.sort((a, b) => b.hosts - a.hosts);

            for (let i = 0; i < subnets.length; i++) {
                const sub = subnets[i];
                
                let neededIps = sub.hosts + 2;
                let bitsHost = Math.ceil(Math.log2(neededIps));
                if (bitsHost < 2) bitsHost = 2; // Máximo CIDR /30
                
                let allocatedIps = Math.pow(2, bitsHost);
                let subCidr = 32 - bitsHost;

                if (currentOffset + allocatedIps > maxAvailableIps) {
                    alert(`Error de direccionamiento: Se ha superado el rango disponible para la red principal /${cidrInput}.`);
                    return;
                }

                let netIpLong = baseIpLong + currentOffset;
                let firstUsableLong = netIpLong + 1;
                let broadcastLong = netIpLong + allocatedIps - 1;
                let lastUsableLong = broadcastLong - 1;

                resultsHTML += `
                    <tr>
                        <td>${sub.id}</td>
                        <td>${sub.name}</td>
                        <td class="txt-center">${sub.hosts}</td>
                        <td class="txt-center">${allocatedIps - 2}</td>
                        <td class="txt-center">${subCidr}</td>
                        <td>${cidrToMask(subCidr)}</td>
                        <td>${getWildcard(subCidr)}</td>
                        <td>${longToIp(netIpLong)}</td>
                        <td>${longToIp(firstUsableLong)}</td>
                        <td>${longToIp(lastUsableLong)}</td>
                        <td>${longToIp(broadcastLong)}</td>
                    </tr>
                `;

                currentOffset += allocatedIps;
            }

        } else {
            // Algoritmo FLSM: Mismo tamaño de máscara adaptado al requerimiento de la subred más grande
            let maxHosts = Math.max(...subnets.map(s => s.hosts));
            let neededIps = maxHosts + 2;
            let bitsHost = Math.ceil(Math.log2(neededIps));
            if (bitsHost < 2) bitsHost = 2; // Máximo CIDR /30

            let allocatedIps = Math.pow(2, bitsHost);
            let subCidr = 32 - bitsHost;

            for (let i = 0; i < subnets.length; i++) {
                const sub = subnets[i];

                if (currentOffset + allocatedIps > maxAvailableIps) {
                    alert(`Error de direccionamiento: Se ha superado el rango disponible para la red principal con FLSM.`);
                    return;
                }

                let netIpLong = baseIpLong + currentOffset;
                let firstUsableLong = netIpLong + 1;
                let broadcastLong = netIpLong + allocatedIps - 1;
                let lastUsableLong = broadcastLong - 1;

                resultsHTML += `
                    <tr>
                        <td>${sub.id}</td>
                        <td>${sub.name}</td>
                        <td class="txt-center">${sub.hosts}</td>
                        <td class="txt-center">${allocatedIps - 2}</td>
                        <td class="txt-center">${subCidr}</td>
                        <td>${cidrToMask(subCidr)}</td>
                        <td>${getWildcard(subCidr)}</td>
                        <td>${longToIp(netIpLong)}</td>
                        <td>${longToIp(firstUsableLong)}</td>
                        <td>${longToIp(lastUsableLong)}</td>
                        <td>${longToIp(broadcastLong)}</td>
                    </tr>
                `;

                currentOffset += allocatedIps;
            }
        }

        // Inyectar resultados y revelar la sección si no hay errores
        resultTbody.innerHTML = resultsHTML;
        panelOutput.classList.add('visible-on-mobile');
        
        // Enfoque hacia los resultados para mejorar la accesibilidad
        panelOutput.scrollIntoView({ behavior: 'smooth' });
    });


    // ======= 4. EXPORTAR DATOS A ARCHIVO CSV COMPATIBLE CON EXCEL =======

    exportCsvBtn.addEventListener('click', () => {
        const rows = resultTbody.querySelectorAll('tr');
        if (rows.length === 0 || rows[0].querySelector('td').getAttribute('colspan')) {
            alert("No hay cálculos para exportar. Haz un cálculo primero.");
            return;
        }

        let csvContent = "\uFEFF"; 

        // Encabezados
        const headers = ["ID", "Subred", "Hosts Requeridos", "Hosts Asignados", "CIDR", "Mascara", "Wildcard Mascara", "Direccion IP", "Primera Util", "Ultima Util", "Broadcast"];
        csvContent += headers.map(h => `"${h}"`).join(";") + "\r\n";

        // Cuerpo
        rows.forEach((row) => {
            const cols = row.querySelectorAll('td');
            const rowData = Array.from(cols).map(c => `"${c.innerText.trim().replace(/\n/g, ' ')}"`).join(";");
            csvContent += rowData + "\r\n";
        });

        // Descarga automática segura
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "Subnetting_Resultados.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
});        document.addEventListener('DOMContentLoaded', () => {
    const subnetsContainer = document.getElementById('subnets-container');
    const addSubnetBtn = document.getElementById('add-subnet-btn');
    const form = document.getElementById('subnet-form');
    const resultTbody = document.getElementById('result-tbody');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const panelOutput = document.getElementById('panel-output');

    // ======= 1. AGREGAR / ELIMINAR ELEMENTOS DINÁMICAMENTE =======

    // Recalcula IDs visuales y asocia labels de accesibilidad
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
            if (btn) {
                btn.setAttribute('aria-label', `Eliminar subred ${id}`);
            }
        });
    }

    // Añadir nueva fila
    addSubnetBtn.addEventListener('click', () => {
        const count = subnetsContainer.querySelectorAll('.subnets-input').length + 1;

        const newRow = document.createElement('div');
        newRow.className = 'subnets-input';
        newRow.innerHTML = `
            <h3>${count}</h3>
            <label class="sr-only" for="subnet-name-${count}">Nombre Subred ${count}</label>
            <input type="text" id="subnet-name-${count}" maxlength="24" placeholder="Ej: LAN Subred ${count}" value="LAN Subred ${count}" required>
            <label class="sr-only" for="subnet-hosts-${count}">Hosts Requeridos Subred ${count}</label>
            <input type="number" id="subnet-hosts-${count}" placeholder="Ej: 150" min="1" max="4294967296" required>
            <button class="btn-erase" type="button" aria-label="Eliminar subred ${count}">X</button>
        `;

        subnetsContainer.appendChild(newRow);
        subnetsContainer.scrollTop = subnetsContainer.scrollHeight; // Auto-scroll
    });

    // Eliminar filas
    subnetsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-erase')) {
            const row = e.target.closest('.subnets-input');
            row.remove();
            recalculateIDs();
        }
    });


    // ======= 2. MOTOR LÓGICO DE CALCULOS DE RED (IP HELPER) =======

    function ipToLong(ip) {
        return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
    }

    function longToIp(long) {
        return [
            (long >>> 24) & 255,
            (long >>> 16) & 255,
            (long >>> 8) & 255,
            long & 255
        ].join('.');
    }

    function getWildcard(cidr) {
        let mask = (0xFFFFFFFF << (32 - cidr)) >>> 0;
        return longToIp(~mask >>> 0);
    }

    function cidrToMask(cidr) {
        if (cidr === 0) return "0.0.0.0";
        let mask = (0xFFFFFFFF << (32 - cidr)) >>> 0;
        return longToIp(mask);
    }


    // ======= 3. EVENTO DE CALCULO PRINCIPAL =======

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const ipInput = document.getElementById('initial-ip').value.trim();
        const cidrInput = parseInt(document.getElementById('initial-cidr').value, 10);
        const method = document.querySelector('input[name="method"]:checked').value;

        // Validar formato IP
        const ipRegex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        if (!ipRegex.test(ipInput)) {
            alert("Por favor, ingresa una dirección IP base válida.");
            return;
        }

        // Recolectar datos de las subredes
        const subnetRows = subnetsContainer.querySelectorAll('.subnets-input');
        let subnets = [];
        let hasError = false;

        subnetRows.forEach((row) => {
            const name = row.querySelector('input[type="text"]').value.trim();
            const hosts = parseInt(row.querySelector('input[type="number"]').value, 10);
            const id = row.querySelector('h3').innerText;

            if (isNaN(hosts) || hosts < 1) {
                hasError = true;
            }

            subnets.push({ id, name, hosts });
        });

        if (subnets.length === 0) {
            alert("Por favor, agrega al menos una subred utilizando el botón 'Agregar'.");
            return;
        }

        if (hasError) {
            alert("Por favor, introduce una cantidad de hosts válida (mínimo 1) para todas las filas.");
            return;
        }

        // Parámetros iniciales
        let baseIpLong = ipToLong(ipInput);
        const maxAvailableIps = Math.pow(2, 32 - cidrInput);
        let currentOffset = 0;

        // Estructura para acumular los cálculos de fila
        let resultsHTML = '';

        if (method === 'vlsm') {
            // Algoritmo VLSM: Ordenar de mayor a menor host para optimizar direccionamiento
            subnets.sort((a, b) => b.hosts - a.hosts);

            for (let i = 0; i < subnets.length; i++) {
                const sub = subnets[i];
                
                let neededIps = sub.hosts + 2;
                let bitsHost = Math.ceil(Math.log2(neededIps));
                if (bitsHost < 2) bitsHost = 2; // Máximo CIDR /30
                
                let allocatedIps = Math.pow(2, bitsHost);
                let subCidr = 32 - bitsHost;

                if (currentOffset + allocatedIps > maxAvailableIps) {
                    alert(`Error de direccionamiento: Se ha superado el rango disponible para la red principal /${cidrInput}.`);
                    return;
                }

                let netIpLong = baseIpLong + currentOffset;
                let firstUsableLong = netIpLong + 1;
                let broadcastLong = netIpLong + allocatedIps - 1;
                let lastUsableLong = broadcastLong - 1;

                resultsHTML += `
                    <tr>
                        <td>${sub.id}</td>
                        <td>${sub.name}</td>
                        <td class="txt-center">${sub.hosts}</td>
                        <td class="txt-center">${allocatedIps - 2}</td>
                        <td class="txt-center">${subCidr}</td>
                        <td>${cidrToMask(subCidr)}</td>
                        <td>${getWildcard(subCidr)}</td>
                        <td>${longToIp(netIpLong)}</td>
                        <td>${longToIp(firstUsableLong)}</td>
                        <td>${longToIp(lastUsableLong)}</td>
                        <td>${longToIp(broadcastLong)}</td>
                    </tr>
                `;

                currentOffset += allocatedIps;
            }

        } else {
            // Algoritmo FLSM: Mismo tamaño de máscara adaptado al requerimiento de la subred más grande
            let maxHosts = Math.max(...subnets.map(s => s.hosts));
            let neededIps = maxHosts + 2;
            let bitsHost = Math.ceil(Math.log2(neededIps));
            if (bitsHost < 2) bitsHost = 2; // Máximo CIDR /30

            let allocatedIps = Math.pow(2, bitsHost);
            let subCidr = 32 - bitsHost;

            for (let i = 0; i < subnets.length; i++) {
                const sub = subnets[i];

                if (currentOffset + allocatedIps > maxAvailableIps) {
                    alert(`Error de direccionamiento: Se ha superado el rango disponible para la red principal con FLSM.`);
                    return;
                }

                let netIpLong = baseIpLong + currentOffset;
                let firstUsableLong = netIpLong + 1;
                let broadcastLong = netIpLong + allocatedIps - 1;
                let lastUsableLong = broadcastLong - 1;

                resultsHTML += `
                    <tr>
                        <td>${sub.id}</td>
                        <td>${sub.name}</td>
                        <td class="txt-center">${sub.hosts}</td>
                        <td class="txt-center">${allocatedIps - 2}</td>
                        <td class="txt-center">${subCidr}</td>
                        <td>${cidrToMask(subCidr)}</td>
                        <td>${getWildcard(subCidr)}</td>
                        <td>${longToIp(netIpLong)}</td>
                        <td>${longToIp(firstUsableLong)}</td>
                        <td>${longToIp(lastUsableLong)}</td>
                        <td>${longToIp(broadcastLong)}</td>
                    </tr>
                `;

                currentOffset += allocatedIps;
            }
        }

        // Inyectar resultados y revelar la sección si no hay errores
        resultTbody.innerHTML = resultsHTML;
        panelOutput.classList.add('visible-on-mobile');
        
        // Enfoque hacia los resultados para mejorar la accesibilidad
        panelOutput.scrollIntoView({ behavior: 'smooth' });
    });


    // ======= 4. EXPORTAR DATOS A ARCHIVO CSV COMPATIBLE CON EXCEL =======

    exportCsvBtn.addEventListener('click', () => {
        const rows = resultTbody.querySelectorAll('tr');
        if (rows.length === 0 || rows[0].querySelector('td').getAttribute('colspan')) {
            alert("No hay cálculos para exportar. Haz un cálculo primero.");
            return;
        }

        let csvContent = "\uFEFF"; 

        // Encabezados
        const headers = ["ID", "Subred", "Hosts Requeridos", "Hosts Asignados", "CIDR", "Mascara", "Wildcard Mascara", "Direccion IP", "Primera Util", "Ultima Util", "Broadcast"];
        csvContent += headers.map(h => `"${h}"`).join(";") + "\r\n";

        // Cuerpo
        rows.forEach((row) => {
            const cols = row.querySelectorAll('td');
            const rowData = Array.from(cols).map(c => `"${c.innerText.trim().replace(/\n/g, ' ')}"`).join(";");
            csvContent += rowData + "\r\n";
        });

        // Descarga automática segura
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "Subnetting_Resultados.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
});